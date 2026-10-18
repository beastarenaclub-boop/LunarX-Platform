import { Router, type IRouter } from "express";
import { paymentHistory, paymentHistoryCsv } from "../services/paymentHistory";
const router: IRouter = Router();
router.get("/", async (req, res, next) => {
  try {
    const result = await paymentHistory(req.user!, req.query);
    res.set("Cache-Control", "no-store");
    if (result.format === "csv")
      res
        .type("text/csv")
        .attachment("payment-history.csv")
        .send(paymentHistoryCsv(result.items));
    else res.json(result);
  } catch (e) {
    next(e);
  }
});
export default router;
