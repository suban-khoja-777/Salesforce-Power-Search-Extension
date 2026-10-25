export const DISPLAY_MODES = ['popup','sidebar','fullpage'];
export function displayMode(mode) { return DISPLAY_MODES.includes(mode) ? mode : 'popup'; }
