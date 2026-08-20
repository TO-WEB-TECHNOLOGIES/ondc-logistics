import axios from "axios";
import { GATEWAY_URL } from "../../constants/v1/appConstants.js";

export const api = axios.create({
  baseURL: GATEWAY_URL,
  headers: {
    "Content-Type": "application/json",
  },
  timeout: 30_000,
});
