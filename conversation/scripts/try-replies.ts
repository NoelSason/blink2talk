import { getReplies } from "../src/claude.js";
try { console.log(await getReplies({ transcript: "are u thirsty?" })); } catch (e: any) { console.log("ERR", e?.status, e?.message); }
