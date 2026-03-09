import crypto from "node:crypto";

const authSecret = crypto.randomBytes(32).toString("hex");
const cronSecret = crypto.randomBytes(32).toString("hex");

console.log(`AUTH_SECRET=${authSecret}`);
console.log(`CRON_SECRET=${cronSecret}`);

