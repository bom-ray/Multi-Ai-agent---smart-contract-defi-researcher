import { indexResearch } from "./research.js";

const force = process.argv.includes("--force");

try {
  console.log(await indexResearch({ force }));
} catch (error) {
  console.error(error);
  process.exit(1);
}
