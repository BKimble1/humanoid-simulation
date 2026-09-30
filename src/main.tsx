import '@fontsource-variable/inter';
import '@fontsource-variable/archivo/wdth.css';

const params = new URLSearchParams(location.search);
if (import.meta.env.DEV && params.get('dev') === '1') {
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;display:block';
  document.body.style.margin = '0';
  document.body.appendChild(canvas);
  import('./dev/harness').then((m) => m.startHarness(canvas));
} else {
  import('./app').then((m) => m.mount(document.getElementById('root')!));
}
