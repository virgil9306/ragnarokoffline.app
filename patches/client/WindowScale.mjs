// Windows drawn larger or smaller, by a mod (api.ui.scale).
//
// The roBrowser fork does the drawing -- UI/UIScale.js scales a window's host
// and the window code keeps dragging, resizing and scrollbars in step -- and
// decides which windows can be scaled at all. This is only the way in. The
// client remembers nothing: a mod that wants the player's choice kept saves it
// itself and sets it again when it starts.

import UIScale from 'UI/UIScale.js';

export function supported() {
    return typeof UIScale?.set === 'function' && typeof UIScale?.names === 'function';
}

export const windows = () => UIScale.names();
export const get = name => UIScale.get(name);
export const set = (name, value) => UIScale.set(name, value);
export const getGlobal = () => UIScale.getGlobal();
export const setGlobal = value => UIScale.setGlobal(value);
