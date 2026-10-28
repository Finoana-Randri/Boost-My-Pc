// Frameless main window on Linux. The interface draws the title bar buttons; this module gives the
// window rounded corners (X11 shape, no transparency) and handles the buttons and the resize edges.
const { BrowserWindow, ipcMain, screen } = require('electron');

const RADIUS = 14;

// Rectangles that cover a width × height window, minus its four rounded corners.
function roundedRects(width, height) {
  if (width < 2 * RADIUS || height < 2 * RADIUS) return [{ x: 0, y: 0, width, height }];
  const rects = [];
  for (let row = 0; row < RADIUS; row++) {
    const inset = Math.ceil(RADIUS - Math.sqrt(RADIUS ** 2 - (RADIUS - row - 0.5) ** 2));
    rects.push({ x: inset, y: row, width: width - 2 * inset, height: 1 });
    rects.push({ x: inset, y: height - 1 - row, width: width - 2 * inset, height: 1 });
  }
  rects.push({ x: 0, y: RADIUS, width, height: height - 2 * RADIUS });
  return rects;
}

// The window manager can make the window full screen without Electron knowing (Super+Up, a
// double-click...), so the size is compared with the screen too.
function fillsScreen(win) {
  if (win.isMaximized() || win.isFullScreen()) return true;
  const bounds = win.getBounds();
  const { workArea } = screen.getDisplayMatching(bounds);
  return bounds.width >= workArea.width && bounds.height >= workArea.height;
}

function attachRoundedShape(win) {
  let timer = null;
  const update = () => {
    clearTimeout(timer);
    // Wait until the window manager has applied the new size.
    timer = setTimeout(() => {
      if (win.isDestroyed()) return;
      const [width, height] = win.getContentSize();
      if (!width || !height) return;
      const full = fillsScreen(win);
      // Never an empty list: on X11 an empty shape hides the whole window.
      win.setShape(full ? [{ x: 0, y: 0, width, height }] : roundedRects(width, height));
      win.webContents.send('win:state', { maximized: full });
    }, 40);
  };
  for (const event of ['resize', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen', 'restore', 'show']) {
    win.on(event, update);
  }
  win.webContents.on('did-finish-load', update);
}

// Edge being dragged, per window. The pointer is followed from here because the interface stops
// receiving mouse events once the pointer leaves the window.
const resizes = new Map();

function stopResize(win) {
  clearInterval(resizes.get(win));
  resizes.delete(win);
}

function startResize(win, edge) {
  stopResize(win);
  if (win.isMaximized() || win.isFullScreen()) return;
  const startBounds = win.getBounds();
  const startPointer = screen.getCursorScreenPoint();
  const [minWidth, minHeight] = win.getMinimumSize();
  const startedAt = Date.now();
  const timer = setInterval(() => {
    // A lost "released" message must not leave the window following the pointer forever.
    if (win.isDestroyed() || Date.now() - startedAt > 60000) return stopResize(win);
    const pointer = screen.getCursorScreenPoint();
    const dx = pointer.x - startPointer.x;
    const dy = pointer.y - startPointer.y;
    let { x, y, width, height } = startBounds;
    if (edge.includes('e')) width = Math.max(minWidth, startBounds.width + dx);
    if (edge.includes('s')) height = Math.max(minHeight, startBounds.height + dy);
    if (edge.includes('w')) {
      width = Math.max(minWidth, startBounds.width - dx);
      x = startBounds.x + startBounds.width - width;
    }
    if (edge.includes('n')) {
      height = Math.max(minHeight, startBounds.height - dy);
      y = startBounds.y + startBounds.height - height;
    }
    win.setBounds({ x, y, width, height });
  }, 12);
  resizes.set(win, timer);
}

const EDGES = new Set(['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']);

function registerWindowControls() {
  ipcMain.on('win:control', (event, action) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return;
    if (action === 'minimize') win.minimize();
    else if (action === 'maximize') {
      if (win.isFullScreen()) win.setFullScreen(false);
      else if (win.isMaximized()) win.unmaximize();
      else win.maximize();
    } else if (action === 'close') win.close();
  });
  ipcMain.on('win:resize', (event, edge) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return;
    if (EDGES.has(edge)) startResize(win, edge);
    else stopResize(win);
  });
}

module.exports = { attachRoundedShape, registerWindowControls, roundedRects };
