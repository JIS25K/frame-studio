// Both deployments use identical capture source; only the planning link is disabled.
import fs from "node:fs";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "..");
const dest = path.resolve(root, "../deployments/capture-app");
for (const dir of [
  "lib/capture",
  "lib/video-capture",
  "lib/prompt-engine",
  "app/api/capture",
])
  fs.cpSync(path.join(root, dir), path.join(dest, dir), { recursive: true });
for (const file of [
  "orbit.module.css",
  "marked-photo.tsx",
  "video-recorder.tsx",
  "video-studio.tsx",
  "video-studio.module.css",
])
  fs.copyFileSync(
    path.join(root, "app/capture", file),
    path.join(dest, "app/capture", file),
  );
for (const file of ["studio-nav.tsx", "studio-nav.module.css"])
  fs.copyFileSync(path.join(root, "app", file), path.join(dest, "app", file));
fs.writeFileSync(
  path.join(dest, "app/page.tsx"),
  `import WholeVideoStudio from './capture/video-studio';
export default function Page(){return <WholeVideoStudio planning={false}/>;}
`,
);
fs.writeFileSync(
  path.join(dest, "app/capture/page.tsx"),
  "export { default } from '../page';\n",
);
const pkg = JSON.parse(
  fs.readFileSync(path.join(dest, "package.json"), "utf8"),
);
pkg.dependencies.mediabunny = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8"),
).dependencies.mediabunny;
fs.writeFileSync(
  path.join(dest, "package.json"),
  JSON.stringify(pkg, null, 2) + "\n",
);
const tsconfig = JSON.parse(
  fs.readFileSync(path.join(dest, "tsconfig.json"), "utf8"),
);
tsconfig.compilerOptions.allowImportingTsExtensions = true;
fs.writeFileSync(
  path.join(dest, "tsconfig.json"),
  JSON.stringify(tsconfig, null, 2) + "\n",
);
console.log("Identical whole-video engine packaged for capture-only demo.");
