/**
 * Adapted from Tsuk1ko/pxder (https://github.com/Tsuk1ko/pxder)
 * Original file: src/pixiv-login.js
 */

import { createHash, randomBytes } from "crypto";
import { Base64 } from "js-base64";
import { stringify } from "qs";

interface PKCEResult {
  code_verifier: string;
  code_challenge: string;
}

interface LoginInfo {
  login_url: string;
  code_verifier: string;
}

const LOGIN_URL = "https://app-api.pixiv.net/web/v1/login";
const randToken = (len: number = 32) => randomBytes(len);
const sha256 = (data: string | Buffer): Buffer =>
  createHash("sha256").update(data).digest();

const oauthPkce = (): PKCEResult => {
  const code_verifier = Base64.fromUint8Array(randToken(), true);
  const code_challenge = Base64.encodeURI(sha256(code_verifier) as any);

  return { code_verifier, code_challenge };
};

export default function generatePixivLogin(): LoginInfo {
  const { code_verifier, code_challenge } = oauthPkce();

  const params = {
    code_challenge,
    code_challenge_method: "S256",
    client: "pixiv-android",
  };

  return {
    login_url: `${LOGIN_URL}?${stringify(params)}`,
    code_verifier,
  };
}
