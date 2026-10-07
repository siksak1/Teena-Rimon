import "dotenv/config";
import { app } from "./app.js";

const PORT = Number(process.env.PORT) || 43124;

app.listen(PORT, "0.0.0.0", () => {
  console.log(
    `Invoice extract API on http://0.0.0.0:${PORT} (NODE_ENV=${process.env.NODE_ENV ?? "undefined"})`,
  );
});
