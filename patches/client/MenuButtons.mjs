// A mod's own button in the game's option menu (api.ui.menuButton).
//
// The roBrowser fork draws it -- UI/MenuHooks.js, read by the Escape window,
// puts it after the menu's settings buttons, drawn from the mod's pictures
// the way the menu draws its own. This is only the way in.

import MenuHooks from 'UI/MenuHooks.js';

export function supported() {
    return typeof MenuHooks?.add === 'function';
}

export const add = button => MenuHooks.add(button);
