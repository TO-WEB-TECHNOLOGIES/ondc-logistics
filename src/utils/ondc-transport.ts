import { NotImplementedError } from "./not-implemented-error.js";
import type { OndcSearchRequest } from "../types/search/ondc.js";

export interface OndcTransport {
  sendSearch(request: OndcSearchRequest): Promise<void>;
}

export class UnconfiguredOndcTransport implements OndcTransport {
  async sendSearch(_request: OndcSearchRequest): Promise<void> {
    throw new NotImplementedError("ONDC transport/signing is not configured yet");
  }
}
