export function createWindowRestorer({ getWindow, create, canOpen }) {
  let opening=null;
  return async function showMainWindow() {
    if (!canOpen()) throw new Error('Privacy consent is required before opening the main window');
    let window=getWindow();
    if (!window || window.isDestroyed()) {
      opening ||= Promise.resolve().then(create).finally(()=>{opening=null;});
      window=await opening;
    }
    if (!window || window.isDestroyed()) throw new Error('Main window is unavailable');
    if (window.isMinimized()) window.restore();
    window.show();window.focus();
    return window;
  };
}
export function mainWindowMenu(showMainWindow, language='zh-CN', onError=console.error) {
  const en=language==='en';
  return {role:'windowMenu',label:en?'Window':'窗口',submenu:[
    {id:'show-main-window',label:en?'Show AI Tip':'显示 AI Tip 主窗口',accelerator:'CmdOrCtrl+Shift+O',click:()=>{void showMainWindow().catch(onError);}},
    {type:'separator'}, {role:'minimize',label:en?'Minimize':'最小化'}, {role:'close',label:en?'Close':'关闭'}
  ]};
}
