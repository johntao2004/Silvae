// 生成公开字体副本，并让样式表使用同一资源路径。
// Prepare public font copies and keep their stylesheet URLs on the same route.
import { cp, readdir, readFile, rm, writeFile } from "node:fs/promises";

const source = new URL("../apps/web/public/fonts/", import.meta.url);
const output = new URL("../apps/web/public/assets/fonts/", import.meta.url);

await rm(output, { recursive: true, force: true });
await cp(source, output, { recursive: true });

for (const name of await readdir(output)) {
  if (!name.endsWith(".css")) continue;
  const file = new URL(name, output);
  const css = await readFile(file, "utf8");
  await writeFile(file, css.replaceAll("/fonts/", "/assets/fonts/"));
}
