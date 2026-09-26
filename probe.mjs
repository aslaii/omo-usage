import { collect } from "./src/credentials.js";
import { render } from "./src/render.js";

console.log(render(await collect()));
