import { app, BrowserWindow, Menu } from 'electron';
import { strict as assert } from 'node:assert';
import { mainWindowMenu, createWindowRestorer } from '../electron/window-menu.mjs';
app.on('window-all-closed',()=>{});
async function main() {
await app.whenReady();
let window, creates=0, allowed=false;
const restore=createWindowRestorer({getWindow:()=>window,canOpen:()=>allowed,create:async()=>{creates++;window=new BrowserWindow({show:false});await window.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<textarea id="draft">Saved draft</textarea>'));return window;}});
try {
  await assert.rejects(restore(),/consent/);assert.equal(creates,0);
  allowed=true;
  Menu.setApplicationMenu(Menu.buildFromTemplate([mainWindowMenu(restore,'en')]));
  const menu=Menu.getApplicationMenu().getMenuItemById('show-main-window');assert.ok(menu);
  menu.click(); await restore();assert.equal(creates,1);assert.ok(window.isVisible());
  const id=window.id;window.hide();menu.click();await new Promise(r=>setTimeout(r,100));
  assert.equal(window.id,id);assert.ok(window.isVisible());assert.equal(await window.webContents.executeJavaScript('document.querySelector("#draft").value'),'Saved draft');
  window.destroy();await Promise.all([restore(),restore()]);assert.equal(creates,2);assert.notEqual(window.id,id);
  console.log(JSON.stringify({actualMenuCallback:true,sameWindowRetained:true,concurrentReopenSingleWindow:true,privacyBlocked:true,evidence:'COMPONENT_CAPABILITY',macOS:'NOT_CAUSALLY_VERIFIED'}));
} finally {window?.destroy();}
}
main().then(()=>app.exit(0),error=>{console.error(error);app.exit(1);});
