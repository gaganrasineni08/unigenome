import { seedDemo } from "./seed";
const r = await seedDemo({ reset: process.argv.includes("--reset") });
console.log(JSON.stringify({ ...r, claimCodes: undefined }, null, 2));
process.exit(0);
