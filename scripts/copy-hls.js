// npm install 后把 hls.js 拷到 app/lib，供电脑浏览器调试播放 m3u8（电视使用系统自带 HLS）
const fs = require('fs');
const path = require('path');

try {
  const src = require.resolve('hls.js/dist/hls.min.js');
  const dest = path.join(__dirname, '..', 'app', 'lib', 'hls.min.js');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  console.log('copied hls.js ->', path.relative(process.cwd(), dest));
} catch (e) {
  console.warn('skip copying hls.js:', e.message);
}
