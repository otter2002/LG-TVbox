# Third-Party Notices

## Vendored files (`service-src/vendor/`)

These files are bundled unmodified as fallbacks for the built-in drpy2 engine, used only
when a subscription's own copies cannot be downloaded.

| File | Original name | Upstream | License |
|---|---|---|---|
| `drpy2.min.txt` | `drpy2.min.js` | [hjdhnx/dr_py](https://github.com/hjdhnx/dr_py) (copy from [gaotianliuyun/gao](https://github.com/gaotianliuyun/gao/tree/master/lib)) | LGPL-3.0 |
| `muban.txt` | `模板.js` | [hjdhnx/dr_py](https://github.com/hjdhnx/dr_py) | LGPL-3.0 |
| `gbk.txt` | `gbk.js` | [hjdhnx/dr_py](https://github.com/hjdhnx/dr_py) | LGPL-3.0 |

They are loaded at runtime as separate modules and are not linked into the MIT-licensed code
of this project. The full LGPL-3.0 text is available at https://www.gnu.org/licenses/lgpl-3.0.html.

## Bundled npm packages (build output only)

`npm run build:service` bundles the following packages into `services/*.js`
(these generated files are not committed to the repository, but are included in the `.ipk`):

| Package | License |
|---|---|
| [cheerio](https://github.com/cheeriojs/cheerio) and its dependencies (parse5, htmlparser2, domhandler, domutils, css-select, …) | MIT / BSD-2-Clause |
| [crypto-js](https://github.com/brix/crypto-js) | MIT |
| [jsonpath-plus](https://github.com/JSONPath-Plus/JSONPath) | MIT |
| [iconv-lite](https://github.com/ashtuchkin/iconv-lite) | MIT |
| [json5](https://github.com/json5/json5) | MIT |
| [pako](https://github.com/nodeca/pako) | MIT AND Zlib |

`npm install` also copies [hls.js](https://github.com/video-dev/hls.js) (Apache-2.0) to `app/lib/`
for desktop-browser debugging.
