import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PORTFOLIO_TOKENS } from "../portfolioTokens.ts";
import { chainLogoUrl, tokenLogoUrl } from "../tokenLogos.ts";

describe("tokenLogoUrl", () => {
  it("finds a symbol in any case", () => {
    assert.equal(
      tokenLogoUrl("USDC"),
      "https://coin-images.coingecko.com/coins/images/6319/large/USDC.png",
    );
    assert.equal(tokenLogoUrl(" usdc "), tokenLogoUrl("USDC"));
  });

  it("follows aliases", () => {
    assert.equal(tokenLogoUrl("euroc"), tokenLogoUrl("EURC"));
    assert.equal(tokenLogoUrl("cbXRP"), tokenLogoUrl("XRP"));
  });

  it("returns null for a symbol it does not list", () => {
    assert.equal(tokenLogoUrl("NOPE"), null);
    assert.equal(tokenLogoUrl(""), null);
    assert.equal(tokenLogoUrl(null), null);
    // Not an own property of the table
    assert.equal(tokenLogoUrl("constructor"), null);
  });

  it("covers every Portfolio token, so none needs a logo.dev key", () => {
    const missing = PORTFOLIO_TOKENS.filter((token) => !tokenLogoUrl(token.symbol)).map(
      (token) => token.symbol,
    );
    assert.deepEqual(missing, []);
  });
});

describe("chainLogoUrl", () => {
  it("knows the supported chains and nothing else", () => {
    for (const key of ["BASE", "ETH", "OP", "POL", "ARB", "GNO"]) {
      assert.match(chainLogoUrl(key) ?? "", /^https:\/\/coin-images\.coingecko\.com\/asset_platforms\//);
    }
    assert.equal(chainLogoUrl("NOPE"), null);
  });
});
