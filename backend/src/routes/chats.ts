import { Router } from "express";
import { getChats } from "../whatsapp";

const router = Router();

router.get("/", (_req, res) => {
  res.json(getChats());
});

export default router;
