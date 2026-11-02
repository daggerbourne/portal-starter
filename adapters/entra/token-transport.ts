import type { TokenTransport } from "./exchange-code.js";

export const entraTokenTransport: TokenTransport = async (request) => {
  const response = await fetch(request.url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: request.body,
  });
  return { status: response.status, body: await response.text() };
};
