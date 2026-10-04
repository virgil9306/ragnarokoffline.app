// Copyright (c) rAthena Dev Teams - Licensed under GNU GPL
// For more information, see LICENCE in the main folder
//
// RAGNAROKMAC: customers for real players' stalls.
//
// A solo world has nobody to buy from a player's vending stall or sell into
// their buying store. This brings the customers a busy server would: once a
// minute, for every stall a real player has open (online or @autotrade), each
// line rolls whether someone buys from it (or sells into it), going by the
// item's market price, how many trade it, the asking price, cheaper fake
// stalls nearby and how busy the map is. Nobody is shown doing it: the sale
// itself is rAthena's, half of it, with the stock "sold" / "bought" report.
//
// The time the server was off is caught up at start (up to 48 hours, in one
// draw per line), and what an @autotrade stall did while its owner was away is
// reported by RODEX mail.
//
// Off unless a mod switches it on, through permanent server variables its
// settings NPC sets at start:
//
//   $@pop_customers_sell        1 = customers buy from players' vending stalls
//   $@pop_customers_buy         1 = sellers sell into players' buying stores
//   $@pop_customers_sell_pct    pace of the first, in percent (100 = as tuned)
//   $@pop_customers_buy_pct     pace of the second
//   $@pop_customers_downtime    1 = catch up the time the server was off
//   $@pop_customers_table$      the price table prefix to use ("prontera-vendors")
//   $@pop_customers_map_default how busy a map is, in percent, unless listed:
//   $@pop_customers_maps$[]     maps, and
//   $@pop_customers_map_pct[]   their percent
//
// $pop_customers_clock is the engine's: the time of its last pass, which tells
// the next start how long the server was off.
//
// Included into population_engine.cpp (one translation unit), after the mod
// vendor code it uses.

#include <cmath>
#include <ctime>
#include <map>

/// What the mod switched on, read from the server variables every pass.
struct PopCustomerSettings {
	bool sell = false, buy = false, downtime = false;
	int sell_pct = 100, buy_pct = 100;
	std::string table;                      ///< "prontera-vendors/"
	int default_map_pct = 100;
	std::unordered_map<std::string, int> map_pct;
};

static int64 pop_customers_reg(const char* name, int32 idx = 0) {
	return mapreg_readreg(reference_uid(add_str(name), idx));
}

static std::string pop_customers_regstr(const char* name, int32 idx = 0) {
	const char* s = mapreg_readregstr(reference_uid(add_str(name), idx));
	return s != nullptr ? s : "";
}

static PopCustomerSettings pop_customers_settings() {
	PopCustomerSettings cs;
	cs.sell = pop_customers_reg("$@pop_customers_sell") != 0;
	cs.buy = pop_customers_reg("$@pop_customers_buy") != 0;
	cs.downtime = pop_customers_reg("$@pop_customers_downtime") != 0;
	if (const int64 v = pop_customers_reg("$@pop_customers_sell_pct"); v > 0)
		cs.sell_pct = static_cast<int>(std::min<int64>(v, 10000));
	if (const int64 v = pop_customers_reg("$@pop_customers_buy_pct"); v > 0)
		cs.buy_pct = static_cast<int>(std::min<int64>(v, 10000));
	cs.table = pop_customers_regstr("$@pop_customers_table$");
	if (!cs.table.empty() && cs.table.back() != '/')
		cs.table += '/';
	if (const int64 v = pop_customers_reg("$@pop_customers_map_default"); v > 0)
		cs.default_map_pct = static_cast<int>(std::min<int64>(v, 1000));
	for (int32 i = 0; i < 64; ++i) {
		const std::string map = pop_customers_regstr("$@pop_customers_maps$", i);
		if (map.empty())
			break;
		cs.map_pct[map] = static_cast<int>(std::max<int64>(0, pop_customers_reg("$@pop_customers_map_pct", i)));
	}
	return cs;
}

/// An item's market price (the middle of its range in the price table, at
/// the mod's price level) and how many sales a day it sees at that price.
struct PopMarketRef {
	double price = 1;
	double buyers_day = 2;  ///< customers for a stall selling it
	double sellers_day = 0; ///< sellers for a buying store wanting it
};

static double pop_customers_plain_price(const PopCustomerSettings& cs, t_itemid nameid, PopMarketRow* row_out = nullptr) {
	std::shared_ptr<item_data> id = item_db.find(nameid);
	double price = id ? std::max<double>({ 1.0, static_cast<double>(id->value_buy), static_cast<double>(id->value_sell) * 2 }) : 1.0;
	auto t = g_pop_market_tables.find(cs.table);
	if (t != g_pop_market_tables.end()) {
		auto r = t->second.find(nameid);
		if (r != t->second.end()) {
			if (row_out)
				*row_out = r->second;
			if (r->second.lo > 0)
				price = (static_cast<double>(r->second.lo) + r->second.hi) / 2;
		}
	}
	const PopModVendorSettings* st = pop_mod_vendor_settings_for_key(cs.table);
	if (st && st->price_pct > 0)
		price = price * st->price_pct / 100;
	return price;
}

static PopMarketRef pop_customers_ref(const PopCustomerSettings& cs, const struct item& it) {
	PopMarketRef ref;
	PopMarketRow row;
	ref.price = pop_customers_plain_price(cs, it.nameid, &row);
	// A refined or carded piece is worth more than the plain one: about what
	// the safe refines cost and the cards are worth. Forged and signed items
	// (card[0] special) have no cards to add.
	if (it.refine > 0)
		ref.price *= 1.0 + 0.05 * it.refine * it.refine;
	if (!itemdb_isspecial(it.card[0]))
		for (int i = 0; i < MAX_SLOTS; ++i)
			if (it.card[i] != 0)
				ref.price += pop_customers_plain_price(cs, it.card[i]);
	ref.buyers_day = row.buyers_day >= 0 ? row.buyers_day : 2;
	ref.sellers_day = row.sellers_day >= 0 ? row.sellers_day : 0;
	return ref;
}

/// How much more (or less) likely a customer buys at this price: snapped up
/// below an NPC's price, gladly under market, normally at it, rarely above,
/// never at twice it.
static double pop_customers_sell_factor(double price, double market, uint32 npc_sell) {
	if (npc_sell > 0 && price < npc_sell)
		return 10.0; // flippers
	const double r = price / std::max(1.0, market);
	if (r <= 0.5) return 3.0;
	if (r < 0.9)  return 3.0 - (r - 0.5) / 0.4 * 1.8;   // 3.0 -> 1.2
	if (r <= 1.1) return 1.0;
	if (r <= 1.5) return 1.0 - (r - 1.1) / 0.4 * 0.9;   // 1.0 -> 0.1
	if (r <= 2.0) return 0.1 - (r - 1.5) / 0.5 * 0.09;  // 0.1 -> 0.01
	return 0.0;
}

/// How much more (or less) likely someone sells into a buying store at this
/// offer: never at or under what an NPC pays (they would go there), rarely at
/// a lowball, normally near market, eagerly above it.
static double pop_customers_buy_factor(double offer, double market, uint32 npc_sell) {
	if (offer <= npc_sell)
		return 0.0;
	const double r = offer / std::max(1.0, market);
	if (r >= 1.5) return 2.0;
	if (r >= 1.0) return 1.5 + (r - 1.0) / 0.5 * 0.5;   // 1.5 -> 2.0
	if (r >= 0.8) return 1.0 + (r - 0.8) / 0.2 * 0.5;   // 1.0 -> 1.5
	if (r >= 0.6) return 0.3 + (r - 0.6) / 0.2 * 0.7;   // 0.3 -> 1.0
	if (r >= 0.4) return 0.05 + (r - 0.4) / 0.2 * 0.25; // 0.05 -> 0.3
	return 0.01;
}

/// How many one customer takes: a stack of cheap loot, a few of anything dear.
static int pop_customers_batch(double price) {
	if (price < 1000)   return rnd_value(5, 50);
	if (price < 20000)  return rnd_value(1, 5);
	if (price < 200000) return rnd_value(1, 2);
	return 1;
}

static double pop_customers_unit() {
	return rnd_value(1, 1000000) / 1000000.0;
}

/// How many customers come in a stretch where lambda are expected.
static int pop_customers_poisson(double lambda) {
	if (lambda <= 0)
		return 0;
	if (lambda > 30) {
		const double z = std::sqrt(-2 * std::log(pop_customers_unit())) * std::cos(6.283185307179586 * pop_customers_unit());
		return std::max(0, static_cast<int>(std::lround(lambda + z * std::sqrt(lambda))));
	}
	const double limit = std::exp(-lambda);
	int k = 0;
	double p = 1;
	do {
		++k;
		p *= pop_customers_unit();
	} while (p > limit);
	return k - 1;
}

/// The fake stalls on a map: the cheapest a shell sells each plain item for,
/// and the most a shell buying store pays. Built once per map per pass.
struct PopMarketSnapshot {
	std::unordered_map<t_itemid, uint32_t> cheapest_sell;
	std::unordered_map<t_itemid, int32_t> best_buy;
};

static PopMarketSnapshot pop_customers_snapshot(int16 m) {
	PopMarketSnapshot s;
	for (map_session_data* o : g_population_engine_pcs) {
		if (o == nullptr || o->m != m)
			continue;
		if (o->state.vending) {
			for (int i = 0; i < o->vend_num; ++i) {
				const int16 ci = o->vending[i].index;
				if (ci < 0 || ci >= MAX_CART)
					continue;
				const struct item& ct = o->cart.u.items_cart[ci];
				if (ct.nameid == 0 || ct.refine != 0 || ct.card[0] != 0)
					continue;
				auto it = s.cheapest_sell.find(ct.nameid);
				if (it == s.cheapest_sell.end() || o->vending[i].value < it->second)
					s.cheapest_sell[ct.nameid] = o->vending[i].value;
			}
		}
		if (o->state.buyingstore) {
			for (int i = 0; i < o->buyingstore.slots; ++i) {
				const s_buyingstore_item& bi = o->buyingstore.items[i];
				auto it = s.best_buy.find(bi.nameid);
				if (it == s.best_buy.end() || bi.price > it->second)
					s.best_buy[bi.nameid] = bi.price;
			}
		}
	}
	return s;
}

static double pop_customers_map_factor(const PopCustomerSettings& cs, int16 m) {
	const map_data* md = map_getmapdata(m);
	if (md == nullptr)
		return 0;
	auto it = cs.map_pct.find(md->name);
	return (it != cs.map_pct.end() ? it->second : cs.default_map_pct) / 100.0;
}

/// What a stall did while its owner was away, for the RODEX report.
struct PopCustomerReport {
	int deals = 0;
	int64 zeny = 0;
	std::map<std::string, std::pair<int, int64>> lines; ///< item name -> (amount, zeny)
	time_t since = 0;
};
static std::unordered_map<uint32_t, PopCustomerReport> g_pop_customer_reports[2]; // [0] stall, [1] buying store
static constexpr time_t POP_CUSTOMERS_REPORT_EVERY = 6 * 3600;

static void pop_customers_note(int kind, uint32_t char_id, const std::string& name, int amount, int64 zeny) {
	PopCustomerReport& r = g_pop_customer_reports[kind][char_id];
	if (r.deals == 0)
		r.since = time(nullptr);
	++r.deals;
	r.zeny += zeny;
	auto& l = r.lines[name];
	l.first += amount;
	l.second += zeny;
}

/// Mail what a stall did while its owner was away, from the Merchant Guild.
static void pop_customers_send_report(int kind, uint32_t char_id) {
	auto it = g_pop_customer_reports[kind].find(char_id);
	if (it == g_pop_customer_reports[kind].end())
		return;
	const PopCustomerReport r = it->second;
	g_pop_customer_reports[kind].erase(it);
	if (r.deals == 0)
		return;

	std::vector<std::pair<std::string, std::pair<int, int64>>> lines(r.lines.begin(), r.lines.end());
	std::sort(lines.begin(), lines.end(), [](const auto& a, const auto& b) { return a.second.second > b.second.second; });
	std::string body = kind == 0 ? "While you were away, customers bought:\n" : "While you were away, sellers brought:\n";
	size_t shown = 0;
	for (const auto& l : lines) {
		char row[128];
		safesnprintf(row, sizeof(row), "%dx %s, %s\n", l.second.first, l.first.c_str(), pop_price_short(static_cast<uint32_t>(std::min<int64>(l.second.second, UINT32_MAX))).c_str());
		if (body.size() + strlen(row) + 40 >= MAIL_BODY_LENGTH)
			break;
		body += row;
		++shown;
	}
	if (shown < lines.size()) {
		char more[48];
		safesnprintf(more, sizeof(more), "...and %zu more.\n", lines.size() - shown);
		body += more;
	}
	char total[64];
	safesnprintf(total, sizeof(total), kind == 0 ? "Total: %s." : "Paid: %s.", pop_price_short(static_cast<uint32_t>(std::min<int64>(r.zeny, UINT32_MAX))).c_str());
	body += total;

	struct mail_message msg;
	memset(&msg, 0, sizeof(msg));
	msg.dest_id = char_id;
	safestrncpy(msg.send_name, "Merchant Guild", NAME_LENGTH);
	char title[MAIL_TITLE_LENGTH];
	if (kind == 0)
		safesnprintf(title, sizeof(title), "Your stall: %d sale%s", r.deals, r.deals == 1 ? "" : "s");
	else
		safesnprintf(title, sizeof(title), "Your buying store: %d deal%s", r.deals, r.deals == 1 ? "" : "s");
	safestrncpy(msg.title, title, MAIL_TITLE_LENGTH);
	safestrncpy(msg.body, body.c_str(), MAIL_BODY_LENGTH);
	msg.status = MAIL_NEW;
	msg.type = MAIL_INBOX_NORMAL;
	msg.timestamp = time(nullptr);
	intif_Mail_send(0, &msg);
}

/// A finished sale or purchase: what it was worth and whether the stall closed
/// (an @autotrade stall that is done leaves, and its sd is gone).
struct PopCustomerDeal {
	int32 zeny = 0;
	bool closed = false;
};

/// The seller's half of vending_purchasereq (vending.cpp), for a customer who
/// is not on the map: zeny to the seller less the vending tax, the item out
/// of the cart, the autotrade row updated, the stock "sold" report, and a
/// sold-out @autotrade stall closed, all as a real purchase does them.
static PopCustomerDeal pop_customers_purchase(map_session_data* vsd, int j, int amount) {
	PopCustomerDeal deal;
	if (j < 0 || j >= vsd->vend_num || amount <= 0)
		return deal;
	const int16 idx = vsd->vending[j].index;
	if (idx < 0 || idx >= MAX_CART)
		return deal;
	amount = std::min<int>({ amount, static_cast<int>(vsd->vending[j].amount), static_cast<int>(vsd->cart.u.items_cart[idx].amount) });
	if (amount <= 0)
		return deal;
	double z = static_cast<double>(vsd->vending[j].value) * amount;
	if (z + vsd->status.zeny > MAX_ZENY)
		return deal;
	if (battle_config.vending_tax && z >= battle_config.vending_tax_min)
		z -= z * (battle_config.vending_tax / 10000.);
	deal.zeny = static_cast<int32>(z);
	const t_itemid nameid = vsd->cart.u.items_cart[idx].nameid;
	const uint32 char_id = vsd->status.char_id;
	const bool away = vsd->state.autotrade;

	pc_getzeny(vsd, deal.zeny, LOG_TYPE_VENDING, 0);
	vsd->vending[j].amount -= amount;
	if (vsd->vending[j].amount) {
		if (Sql_Query(mmysql_handle, "UPDATE `%s` SET `amount` = %d WHERE `vending_id` = %d and `cartinventory_id` = %d",
		    vending_items_table, vsd->vending[j].amount, vsd->vender_id, vsd->cart.u.items_cart[idx].id) != SQL_SUCCESS)
			Sql_ShowDebug(mmysql_handle);
	} else {
		if (Sql_Query(mmysql_handle, "DELETE FROM `%s` WHERE `vending_id` = %d and `cartinventory_id` = %d",
		    vending_items_table, vsd->vender_id, vsd->cart.u.items_cart[idx].id) != SQL_SUCCESS)
			Sql_ShowDebug(mmysql_handle);
	}
	pc_cart_delitem(vsd, idx, amount, 0, LOG_TYPE_VENDING);
	clif_vendingreport(*vsd, idx, amount, 0, deal.zeny);

	// compact the vending list
	int cursor = 0;
	for (int i = 0; i < vsd->vend_num; ++i) {
		if (vsd->vending[i].amount == 0)
			continue;
		if (cursor != i)
			vsd->vending[cursor] = vsd->vending[i];
		++cursor;
	}
	vsd->vend_num = cursor;

	if (save_settings & CHARSAVE_VENDING)
		chrif_save(vsd, CSAVE_INVENTORY | CSAVE_CART);

	if (away) {
		std::shared_ptr<item_data> id = item_db.find(nameid);
		pop_customers_note(0, char_id, id ? id->ename : std::string("?"), amount, deal.zeny);
		if (vsd->vend_num == 0) {
			vending_closevending(vsd);
			map_quit(vsd);
			deal.closed = true;
			pop_customers_send_report(0, char_id);
		}
	}
	return deal;
}

/// The buyer's half of buyingstore_trade (buyingstore.cpp), for a seller who
/// is not on the map: the item into the store owner's inventory, the zeny out
/// of their limit, the store rows updated, the stock "bought" report, and a
/// store that has all it wanted (or spent its limit) closed.
static PopCustomerDeal pop_customers_sell_to(map_session_data* bsd, int listidx, int amount) {
	PopCustomerDeal deal;
	if (listidx < 0 || listidx >= bsd->buyingstore.slots || amount <= 0)
		return deal;
	s_buyingstore_item& bi = bsd->buyingstore.items[listidx];
	if (bi.amount == 0 || bi.price <= 0)
		return deal;
	// The owner may have less zeny than the store's limit by now (spent while
	// it was open): buyingstore_trade lowers the limit to it before a trade,
	// and so does this. Otherwise pc_payzeny below refuses after the item is
	// already in the inventory, and the item is free.
	if (bsd->status.zeny < bsd->buyingstore.zenylimit)
		bsd->buyingstore.zenylimit = bsd->status.zeny;
	amount = std::min<int>(amount, bi.amount);
	amount = std::min<int>(amount, bsd->buyingstore.zenylimit / bi.price);
	const int32 w = itemdb_weight(bi.nameid);
	if (w > 0)
		amount = std::min<int>(amount, (bsd->max_weight - bsd->weight) / w);
	if (amount <= 0 || pc_checkadditem(bsd, bi.nameid, amount) == CHKADDITEM_OVERAMOUNT)
		return deal;
	if (pc_checkadditem(bsd, bi.nameid, amount) == CHKADDITEM_NEW && pc_inventoryblank(bsd) == 0)
		return deal;

	if (static_cast<int64>(amount) * bi.price > bsd->status.zeny)
		return deal;

	struct item it = {};
	it.nameid = bi.nameid;
	it.identify = 1;
	if (pc_additem(bsd, &it, amount, LOG_TYPE_BUYING_STORE) != ADDITEM_SUCCESS)
		return deal;
	const t_itemid nameid = bi.nameid;
	const uint32 char_id = bsd->status.char_id;
	const bool away = bsd->state.autotrade;
	bi.amount -= amount;
	if (bi.amount > 0) {
		if (Sql_Query(mmysql_handle, "UPDATE `%s` SET `amount` = %d WHERE `buyingstore_id` = %d AND `index` = %d;",
		    buyingstore_items_table, bi.amount, bsd->buyer_id, listidx) != SQL_SUCCESS)
			Sql_ShowDebug(mmysql_handle);
	} else {
		if (Sql_Query(mmysql_handle, "DELETE FROM `%s` WHERE `buyingstore_id` = %d AND `index` = %d;",
		    buyingstore_items_table, bsd->buyer_id, listidx) != SQL_SUCCESS)
			Sql_ShowDebug(mmysql_handle);
	}
	deal.zeny = amount * bi.price;
	pc_payzeny(bsd, deal.zeny, LOG_TYPE_BUYING_STORE, 0);
	bsd->buyingstore.zenylimit -= deal.zeny;
	clif_buyingstore_update_item(bsd, nameid, amount, 0, deal.zeny);

	if (save_settings & CHARSAVE_VENDING)
		chrif_save(bsd, CSAVE_NORMAL | CSAVE_INVENTORY);

	if (away) {
		std::shared_ptr<item_data> id = item_db.find(nameid);
		pop_customers_note(1, char_id, id ? id->ename : std::string("?"), amount, deal.zeny);
	}

	int i;
	ARR_FIND(0, bsd->buyingstore.slots, i, bsd->buyingstore.items[i].amount != 0);
	if (i == bsd->buyingstore.slots || bsd->buyingstore.zenylimit == 0) {
		// 4 "All items were purchased", 3 "All items within the buy limit were
		// purchased" (BUYINGSTORE_TRADE_BUYER_*, private to buyingstore.cpp).
		clif_buyingstore_trade_failed_buyer(bsd, i == bsd->buyingstore.slots ? 4 : 3);
		buyingstore_close(bsd);
		if (away) {
			map_quit(bsd);
			deal.closed = true;
			pop_customers_send_report(1, char_id);
		}
	} else if (Sql_Query(mmysql_handle, "UPDATE `%s` SET `limit` = %d WHERE `id` = %d;",
	           buyingstores_table, bsd->buyingstore.zenylimit, bsd->buyer_id) != SQL_SUCCESS) {
		Sql_ShowDebug(mmysql_handle);
	}
	return deal;
}

/// One player's vending stall over `minutes`: per line, the customers that
/// come (a draw on how many are expected), each taking a batch. Returns the
/// sales made; *closed when the stall left.
static int pop_customers_run_stall(map_session_data* vsd, const PopCustomerSettings& cs, const PopMarketSnapshot& snap,
	double minutes, bool* closed)
{
	const double busy = pop_customers_map_factor(cs, vsd->m) * cs.sell_pct / 100.0;
	if (busy <= 0)
		return 0;
	std::vector<std::pair<int16, uint32>> lines; // cart index, asking price
	for (int j = 0; j < vsd->vend_num; ++j)
		lines.emplace_back(vsd->vending[j].index, vsd->vending[j].value);
	int sales = 0;
	for (const auto& line : lines) {
		const int16 idx = line.first;
		if (idx < 0 || idx >= MAX_CART)
			continue;
		const struct item it = vsd->cart.u.items_cart[idx]; // a copy: the cart changes as it sells
		std::shared_ptr<item_data> id = item_db.find(it.nameid);
		if (it.nameid == 0 || !id)
			continue;
		const PopMarketRef ref = pop_customers_ref(cs, it);
		double f = pop_customers_sell_factor(line.second, ref.price, id->value_sell) * busy;
		if (it.refine == 0 && it.card[0] == 0) {
			auto c = snap.cheapest_sell.find(it.nameid);
			if (c != snap.cheapest_sell.end() && c->second < line.second)
				f *= c->second < line.second * 0.95 ? 0.3 : 0.5; // customers go to the cheaper stall first
		}
		const int customers = std::min(pop_customers_poisson(ref.buyers_day / 1440.0 * minutes * f), 500);
		for (int n = 0; n < customers; ++n) {
			int j;
			ARR_FIND(0, vsd->vend_num, j, vsd->vending[j].index == idx);
			if (j == vsd->vend_num)
				break; // sold out
			const PopCustomerDeal deal = pop_customers_purchase(vsd, j, pop_customers_batch(ref.price));
			if (deal.zeny > 0)
				++sales;
			if (deal.closed) {
				*closed = true;
				return sales;
			}
		}
	}
	return sales;
}

/// One player's buying store over `minutes`: per wanted item, the sellers
/// that come, each bringing a batch.
static int pop_customers_run_store(map_session_data* bsd, const PopCustomerSettings& cs, const PopMarketSnapshot& snap,
	double minutes, bool* closed)
{
	const double busy = pop_customers_map_factor(cs, bsd->m) * cs.buy_pct / 100.0;
	if (busy <= 0)
		return 0;
	int deals = 0;
	for (int i = 0; i < bsd->buyingstore.slots; ++i) {
		const s_buyingstore_item bi = bsd->buyingstore.items[i];
		std::shared_ptr<item_data> id = item_db.find(bi.nameid);
		if (bi.amount == 0 || !id)
			continue;
		struct item plain = {};
		plain.nameid = bi.nameid;
		const PopMarketRef ref = pop_customers_ref(cs, plain);
		double f = pop_customers_buy_factor(bi.price, ref.price, id->value_sell) * busy;
		auto b = snap.best_buy.find(bi.nameid);
		if (b != snap.best_buy.end() && b->second > bi.price)
			f *= b->second > bi.price * 1.05 ? 0.3 : 0.5; // sellers go to the better offer first
		const int sellers = std::min(pop_customers_poisson(ref.sellers_day / 1440.0 * minutes * f), 500);
		for (int n = 0; n < sellers; ++n) {
			if (!bsd->state.buyingstore || bsd->buyingstore.items[i].amount == 0)
				break;
			const PopCustomerDeal deal = pop_customers_sell_to(bsd, i, pop_customers_batch(ref.price));
			if (deal.zeny > 0)
				++deals;
			if (deal.closed) {
				*closed = true;
				return deals;
			}
			if (!bsd->state.buyingstore)
				return deals;
		}
	}
	return deals;
}

/// Players' stalls and stores, the real ones only (not shells).
static std::vector<map_session_data*> pop_customers_player_stalls(int16 m = -1) {
	std::vector<map_session_data*> out;
	s_mapiterator* iter = mapit_getallusers();
	for (map_session_data* sd = (map_session_data*)mapit_first(iter); mapit_exists(iter); sd = (map_session_data*)mapit_next(iter)) {
		if (sd == nullptr || IS_POPULATION_ENGINE_ACCOUNT_ID(sd->status.account_id))
			continue;
		if (m >= 0 && sd->m != m)
			continue;
		if (sd->state.vending || sd->state.buyingstore)
			out.push_back(sd);
	}
	mapit_free(iter);
	return out;
}

/// Run every player stall over `minutes`. Returns (stalls, deals).
static std::pair<int, int> pop_customers_run_all(const PopCustomerSettings& cs, const std::vector<map_session_data*>& stalls, double minutes) {
	std::unordered_map<int16, PopMarketSnapshot> snaps;
	int ran = 0, deals = 0;
	for (map_session_data* sd : stalls) {
		const uint32 char_id = sd->status.char_id;
		if (!snaps.count(sd->m))
			snaps[sd->m] = pop_customers_snapshot(sd->m);
		bool closed = false;
		if (sd->state.vending && cs.sell) {
			deals += pop_customers_run_stall(sd, cs, snaps[sd->m], minutes, &closed);
			++ran;
		} else if (sd->state.buyingstore && cs.buy) {
			deals += pop_customers_run_store(sd, cs, snaps[sd->m], minutes, &closed);
			++ran;
		}
		(void)char_id;
	}
	return { ran, deals };
}

static int64 g_pop_customers_downtime = -1;   ///< Seconds the server was off, known after the first pass.
static time_t g_pop_customers_started = 0;    ///< When the first pass ran.
static std::unordered_set<uint32_t> g_pop_customers_caught_up; ///< Stalls given the downtime already.
static double g_pop_customers_last_ms = 0;    ///< How long the last pass took, for @vendorinfo customers.
static constexpr int64 POP_CUSTOMERS_DOWNTIME_CAP = 48 * 3600;
/// Autotraders restored at start (feature.autotrade_open_delay, seconds) get
/// the downtime; a stall a player opens later never does.
static constexpr time_t POP_CUSTOMERS_CATCHUP_WINDOW = 2 * 60;

/// Once a minute (from the vendor rotation timer): the customers of every
/// player stall, the downtime for @autotrade stalls just restored, reports
/// for stalls whose owner is still away after six hours or has come back.
static void population_customers_pass() {
	const auto t0 = std::chrono::steady_clock::now();
	// No mod asked for customers (no price table named): nothing at all, not
	// even the clock, so a server without one runs exactly as before.
	const PopCustomerSettings cs = pop_customers_settings();
	if (cs.table.empty())
		return;
	const time_t now = time(nullptr);
	const int64 clock_uid = reference_uid(add_str("$pop_customers_clock"), 0);
	if (g_pop_customers_downtime < 0) {
		const int64 last = mapreg_readreg(clock_uid);
		g_pop_customers_downtime = last > 0 && now > last ? std::min<int64>(now - last, POP_CUSTOMERS_DOWNTIME_CAP) : 0;
		g_pop_customers_started = now;
		if (g_pop_customers_downtime >= 60)
			ShowInfo("Population engine: the server was off for %" PRId64 " minute(s).\n", g_pop_customers_downtime / 60);
	}
	mapreg_setreg(clock_uid, now);

	if (!cs.sell && !cs.buy) {
		g_pop_customers_last_ms = 0;
		return;
	}
	const std::vector<map_session_data*> stalls = pop_customers_player_stalls();

	// The time the server was off, once, for each @autotrade stall restored at
	// start. Its own pass this minute is then skipped.
	std::vector<map_session_data*> live;
	std::vector<map_session_data*> catch_up;
	for (map_session_data* sd : stalls) {
		if (cs.downtime && sd->state.autotrade && g_pop_customers_downtime >= 60 &&
		    now - g_pop_customers_started <= POP_CUSTOMERS_CATCHUP_WINDOW &&
		    g_pop_customers_caught_up.insert(sd->status.char_id).second)
			catch_up.push_back(sd);
		else
			live.push_back(sd);
	}
	if (!catch_up.empty()) {
		std::vector<uint32_t> ids;
		for (map_session_data* sd : catch_up)
			ids.push_back(sd->status.char_id);
		const auto r = pop_customers_run_all(cs, catch_up, g_pop_customers_downtime / 60.0);
		ShowInfo("Population engine: customers caught up %d player stall(s) over the downtime: %d deal(s).\n", r.first, r.second);
		for (uint32_t id : ids) {
			pop_customers_send_report(0, id);
			pop_customers_send_report(1, id);
		}
	}
	pop_customers_run_all(cs, live, 1.0);

	// Reports: a stall whose owner came back (no longer away), or one that
	// has been selling for six hours with its owner still away.
	std::unordered_set<uint32_t> away;
	for (map_session_data* sd : pop_customers_player_stalls())
		if (sd->state.autotrade)
			away.insert(sd->status.char_id);
	for (int kind = 0; kind < 2; ++kind) {
		std::vector<uint32_t> due;
		for (const auto& kv : g_pop_customer_reports[kind])
			if (!away.count(kv.first) || now - kv.second.since >= POP_CUSTOMERS_REPORT_EVERY)
				due.push_back(kv.first);
		for (uint32_t id : due)
			pop_customers_send_report(kind, id);
	}
	g_pop_customers_last_ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();
}

/// @vendorinfo customers [ff <minutes>]: the customer model for the player
/// stalls on the GM's map, or a fast-forward of them.
static void population_customers_info(map_session_data* sd, const std::string& arg) {
	const int fd = sd->fd;
	char buf[CHAT_SIZE_MAX];
	const PopCustomerSettings cs = pop_customers_settings();
	safesnprintf(buf, sizeof(buf), "Customers: stalls %s (%d%%), buying stores %s (%d%%), downtime %s, table '%s', last pass %.2f ms.",
		cs.sell ? "on" : "off", cs.sell_pct, cs.buy ? "on" : "off", cs.buy_pct, cs.downtime ? "on" : "off",
		cs.table.c_str(), g_pop_customers_last_ms);
	clif_displaymessage(fd, buf);

	int minutes = 0;
	if (sscanf(arg.c_str(), "ff %d", &minutes) == 1) {
		minutes = std::max(1, std::min(minutes, 2880));
		std::vector<map_session_data*> stalls = pop_customers_player_stalls(sd->m);
		const auto r = pop_customers_run_all(cs, stalls, minutes);
		safesnprintf(buf, sizeof(buf), "Fast-forwarded %d minute(s): %d stall(s), %d deal(s). Away owners' reports are sent as usual.", minutes, r.first, r.second);
		clif_displaymessage(fd, buf);
		return;
	}

	const PopMarketSnapshot snap = pop_customers_snapshot(sd->m);
	const double busy_map = pop_customers_map_factor(cs, sd->m);
	size_t n = 0;
	for (map_session_data* o : pop_customers_player_stalls(sd->m)) {
		++n;
		safesnprintf(buf, sizeof(buf), "%s (%d,%d): %s%s, map %d%%", o->status.name, o->x, o->y,
			o->state.vending ? "stall" : "buying store", o->state.autotrade ? ", away" : "", static_cast<int>(busy_map * 100));
		clif_displaymessage(fd, buf);
		if (o->state.vending) {
			for (int j = 0; j < o->vend_num; ++j) {
				const int16 idx = o->vending[j].index;
				if (idx < 0 || idx >= MAX_CART) continue;
				const struct item& it = o->cart.u.items_cart[idx];
				std::shared_ptr<item_data> id = item_db.find(it.nameid);
				if (!id) continue;
				const PopMarketRef ref = pop_customers_ref(cs, it);
				double f = pop_customers_sell_factor(o->vending[j].value, ref.price, id->value_sell);
				auto c = snap.cheapest_sell.find(it.nameid);
				const bool undercut = it.refine == 0 && it.card[0] == 0 && c != snap.cheapest_sell.end() && c->second < o->vending[j].value;
				if (undercut) f *= c->second < o->vending[j].value * 0.95 ? 0.3 : 0.5;
				const double per_day = ref.buyers_day * f * busy_map * cs.sell_pct / 100.0;
				safesnprintf(buf, sizeof(buf), "  %s x%d at %s (market %s): x%.2f%s, %.1f customer(s)/day",
					id->ename.c_str(), o->vending[j].amount, pop_price_short(o->vending[j].value).c_str(),
					pop_price_short(static_cast<uint32_t>(ref.price)).c_str(), f, undercut ? " (undercut)" : "", per_day);
				clif_displaymessage(fd, buf);
			}
		} else {
			for (int i = 0; i < o->buyingstore.slots; ++i) {
				const s_buyingstore_item& bi = o->buyingstore.items[i];
				std::shared_ptr<item_data> id = item_db.find(bi.nameid);
				if (!id || bi.amount == 0) continue;
				struct item plain = {};
				plain.nameid = bi.nameid;
				const PopMarketRef ref = pop_customers_ref(cs, plain);
				double f = pop_customers_buy_factor(bi.price, ref.price, id->value_sell);
				auto b = snap.best_buy.find(bi.nameid);
				const bool outbid = b != snap.best_buy.end() && b->second > bi.price;
				if (outbid) f *= b->second > bi.price * 1.05 ? 0.3 : 0.5;
				const double per_day = ref.sellers_day * f * busy_map * cs.buy_pct / 100.0;
				safesnprintf(buf, sizeof(buf), "  %s x%d at %s (market %s): x%.2f%s, %.1f seller(s)/day",
					id->ename.c_str(), bi.amount, pop_price_short(static_cast<uint32_t>(bi.price)).c_str(),
					pop_price_short(static_cast<uint32_t>(ref.price)).c_str(), f, outbid ? " (outbid)" : "", per_day);
				clif_displaymessage(fd, buf);
			}
		}
	}
	safesnprintf(buf, sizeof(buf), "%zu player stall(s) on this map. @vendorinfo customers ff <minutes> fast-forwards them.", n);
	clif_displaymessage(fd, buf);
}
