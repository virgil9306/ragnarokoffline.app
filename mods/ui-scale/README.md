# ui-scale

Draw the game's windows larger or smaller: a hotbar you can read from the
couch on a TV, a smaller chat on a laptop.

Press **Escape** (or the basic info window's **Option** button) and choose
**UI Scale**. "All windows" sets the size of every window at once; each
window below it is drawn at that size times its own. Sizes go from 50% to
300% and are kept between sessions. **Reset all** puts everything back.
Off until you switch it on in Settings → Mods.

Browser zoom (Ctrl +) is the other way to make the interface larger: it
scales every window at once and leaves the 3D view alone. The two combine.

Only the windows the client has checked to keep working at another size are
listed: the hotbar, chat, inventory, buff icons, basic info, minimap, the
gamepad hotbar along the bottom and the other common windows. The rest stay as they are.

It is also the worked example of two client API features:

- **Window sizes:** `api.ui.scale` (`windows()`, `set(window, factor)`,
  `setGlobal(factor)`). The client remembers nothing, so the mod keeps the
  sizes in `api.preferences` and sets them again in `init`.
- **A button in the option menu:** `api.ui.menuButton({ background, hover,
  down, title, onClick })`, drawn from the pictures in
  [`data/texture/ui/`](data/texture/ui).

The three button pictures are made by
[`tools/make-menu-button.py`](tools/make-menu-button.py) from the menu's own
Settings button (the vendored English translation's `esc_06a/b/c.bmp`): the
label painted over and lettered again in the same font, colour and shadow.
Run it again with `--label` and `--name` for a button of your own.

See docs/MODDING.md, "Window sizes" and "A button in the option menu".
