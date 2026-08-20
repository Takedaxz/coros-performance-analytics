import asyncio
import base64
import hashlib
import json
import logging
import random
from typing import Any, cast

import httpx
from Crypto.Cipher import AES
from redis.asyncio import Redis

logger = logging.getLogger(__name__)

# Token TTLs — kept shorter than Coros' actual expiry to avoid using a stale token
_ACCESS_TOKEN_TTL_SECONDS = 3600  # 1 hour
_MOBILE_TOKEN_TTL_SECONDS = 3600  # 1 hour

_REDIS_KEY_ACCESS_TOKEN = "coros:token:access"
_REDIS_KEY_MOBILE_TOKEN = "coros:token:mobile"
_REDIS_KEY_USER_ID = "coros:token:user_id"


def _rate_limit_delay(retry_after: str | None) -> float:
    try:
        seconds = float(retry_after) if retry_after is not None else 1.0
    except ValueError:
        seconds = 1.0
    return min(max(seconds, 0.0), 5.0)


def _training_hub_token_invalid(status_code: int, body: object) -> bool:
    return status_code == 401 or (
        status_code == 200
        and isinstance(body, dict)
        and body.get("result") != "0000"
        and "token" in str(body.get("message", "")).lower()
    )


class CorosApiClientError(Exception):
    pass


class CorosApiClient:
    def __init__(
        self,
        email: str,
        password: str,
        region: str = "us",
        redis: Redis | None = None,
    ) -> None:
        self.email = email
        self.password = password
        self.region = region
        self.redis = redis
        self.access_token: str | None = None
        self.mobile_access_token: str | None = None
        self.user_id: str | None = None
        self.base_url = self._get_base_url(region)
        self.mobile_base_url = (
            "https://apieu.coros.com" if region == "eu" else "https://api.coros.com"
        )

    def _get_base_url(self, region: str) -> str:
        urls = {
            "eu": "https://teameuapi.coros.com",
            "us": "https://teamapi.coros.com",
            "asia": "https://teamcnapi.coros.com",
            "cn": "https://teamcnapi.coros.com",
        }
        return urls.get(region, "https://teamapi.coros.com")

    def _md5(self, value: str) -> str:
        return hashlib.md5(value.encode()).hexdigest()

    async def _load_cached_token(self) -> bool:
        """Load access token from Redis. Returns True if a valid cached token was found."""
        if not self.redis:
            return False
        try:
            token = await self.redis.get(_REDIS_KEY_ACCESS_TOKEN)
            user_id = await self.redis.get(_REDIS_KEY_USER_ID)
            if token:
                self.access_token = token.decode() if isinstance(token, bytes) else token
                self.user_id = user_id.decode() if isinstance(user_id, bytes) else user_id
                return True
        except Exception:
            logger.warning("redis_token_load_failed: falling back to fresh login")
        return False

    async def _cache_token(self, token: str, user_id: str | None) -> None:
        """Persist access token to Redis."""
        if not self.redis:
            return
        try:
            await self.redis.setex(_REDIS_KEY_ACCESS_TOKEN, _ACCESS_TOKEN_TTL_SECONDS, token)
            if user_id:
                await self.redis.setex(_REDIS_KEY_USER_ID, _ACCESS_TOKEN_TTL_SECONDS, user_id)
        except Exception:
            logger.warning("redis_token_cache_failed: token will not be cached")

    async def _invalidate_token(self) -> None:
        """Remove cached access token (called when a 401 is received)."""
        self.access_token = None
        self.user_id = None
        if not self.redis:
            return
        try:
            await self.redis.delete(_REDIS_KEY_ACCESS_TOKEN, _REDIS_KEY_USER_ID)
        except Exception:
            logger.warning("redis_token_invalidate_failed")

    async def login(self) -> None:
        """Authenticate with the Coros team API.

        Uses the cached Redis token if available. Only performs a network login
        when no valid cached token exists.
        """
        if self.access_token:
            return  # Already have a token in memory for this request cycle

        if await self._load_cached_token():
            logger.debug("coros_login: using cached token")
            return

        if not self.email or not self.password:
            raise CorosApiClientError("Missing Coros credentials")

        url = f"{self.base_url}/account/login"
        payload = {
            "account": self.email,
            "accountType": 2,
            "pwd": self._md5(self.password),
        }
        headers = {
            "Content-Type": "application/json",
            "User-Agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36"
            ),
        }

        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(url, json=payload, headers=headers)
            resp.raise_for_status()
            body = resp.json()

            if body.get("result") != "0000":
                raise CorosApiClientError(f"Login failed: {body.get('message')}")

            data = body.get("data", {})
            self.access_token = data.get("accessToken")
            self.user_id = data.get("userId")

        await self._cache_token(self.access_token, self.user_id)
        logger.info("coros_login: fresh login completed, token cached")

    def _get_auth_headers(self) -> dict[str, str]:
        if not self.access_token:
            raise CorosApiClientError("Not logged in")
        return {
            "Content-Type": "application/json",
            "User-Agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36"
            ),
            "accessToken": self.access_token,
        }

    def _get_training_hub_headers(self) -> dict[str, str]:
        if not self.access_token:
            raise CorosApiClientError("Not logged in")
        headers = {
            "accesstoken": self.access_token,
            "Accept": "application/json, text/plain, */*",
        }
        if self.user_id:
            headers["yfheader"] = json.dumps({"userId": self.user_id})
        return headers

    async def _get_json(
        self, client: httpx.AsyncClient, url: str, params: dict[str, Any] | None = None
    ) -> dict:
        """GET with automatic token refresh on 401 or API-level token error."""
        resp = await client.get(url, params=params, headers=self._get_auth_headers())
        if resp.status_code == 429:
            delay = _rate_limit_delay(resp.headers.get("Retry-After"))
            logger.warning("coros_api: rate limited, retrying once in %.1fs", delay)
            await asyncio.sleep(delay)
            resp = await client.get(url, params=params, headers=self._get_auth_headers())

        body = None
        is_token_invalid = resp.status_code == 401

        if resp.status_code == 200:
            body = resp.json()
            if body.get("result") != "0000" and "token" in body.get("message", "").lower():
                is_token_invalid = True

        if is_token_invalid:
            logger.warning("coros_api: received token error, invalidating token and retrying")
            await self._invalidate_token()
            await self.login()
            resp = await client.get(url, params=params, headers=self._get_auth_headers())
            body = None  # Force re-parse

        resp.raise_for_status()
        return body if body is not None else resp.json()

    async def fetch_activities(self, start_day: str, end_day: str, size: int = 100) -> list[dict]:
        """Fetch all activity summaries for a date range (YYYYMMDD) handling pagination."""
        url = f"{self.base_url}/activity/query"
        all_activities = []
        page_number = 1

        async with httpx.AsyncClient(timeout=30) as client:
            while True:
                params = {
                    "startDay": start_day,
                    "endDay": end_day,
                    "pageNumber": page_number,
                    "size": size,
                }

                body = await self._get_json(client, url, params)

                if body.get("result") != "0000":
                    raise CorosApiClientError(f"Failed to fetch activities: {body.get('message')}")

                data = body.get("data", {})
                page_data = data.get("dataList", data.get("list", []))

                if not page_data:
                    break

                all_activities.extend(page_data)

                if len(page_data) < size:
                    break

                page_number += 1

        return all_activities

    async def fetch_training_schedule(self, start_day: str, end_day: str) -> dict[str, object]:
        """Fetch calendar workouts from the COROS Training Hub."""
        url = f"{self.base_url}/training/schedule/query"
        params: dict[str, str | int] = {
            "startDate": start_day,
            "endDate": end_day,
            "supportRestExercise": 1,
        }
        async with httpx.AsyncClient(timeout=30) as client:
            for attempt in range(2):
                response = await client.get(
                    url, params=params, headers=self._get_training_hub_headers()
                )
                body: object = response.json() if response.status_code == 200 else None
                if not attempt and _training_hub_token_invalid(response.status_code, body):
                    await self._invalidate_token()
                    await self.login()
                    continue
                response.raise_for_status()
                if not isinstance(body, dict):
                    raise CorosApiClientError("Training calendar returned an invalid response.")
                if body.get("result") != "0000":
                    raise CorosApiClientError(
                        f"Failed to fetch training calendar: {body.get('message')}"
                    )
                data = body.get("data")
                return cast("dict[str, object]", data) if isinstance(data, dict) else {}
        raise CorosApiClientError("Failed to fetch training calendar")

    async def post_training_hub(
        self,
        path: str,
        payload: object,
        params: dict[str, str | int] | None = None,
    ) -> object:
        """Send a confirmed write or calculation request to the Training Hub."""
        if not path.startswith("/training/"):
            raise CorosApiClientError("Unsupported Training Hub path")
        url = f"{self.base_url}{path}"
        async with httpx.AsyncClient(timeout=30) as client:
            for attempt in range(2):
                response = await client.post(
                    url,
                    params=params,
                    json=payload,
                    headers=self._get_training_hub_headers(),
                )
                body: object = response.json() if response.status_code == 200 else None
                if not attempt and _training_hub_token_invalid(response.status_code, body):
                    await self._invalidate_token()
                    await self.login()
                    continue
                response.raise_for_status()
                if not isinstance(body, dict):
                    raise CorosApiClientError("Training Hub returned an invalid response.")
                if body.get("result") != "0000":
                    raise CorosApiClientError(
                        f"Training Hub rejected the request: {body.get('message')}"
                    )
                return body.get("data")
        raise CorosApiClientError("Training Hub request failed")

    async def get_training_hub(
        self, path: str, params: dict[str, str | int] | None = None
    ) -> object:
        """Read a Training Hub resource with the authenticated athlete session."""
        if not path.startswith("/training/"):
            raise CorosApiClientError("Unsupported Training Hub path")
        url = f"{self.base_url}{path}"
        async with httpx.AsyncClient(timeout=30) as client:
            for attempt in range(2):
                response = await client.get(
                    url, params=params, headers=self._get_training_hub_headers()
                )
                body: object = response.json() if response.status_code == 200 else None
                if not attempt and _training_hub_token_invalid(response.status_code, body):
                    await self._invalidate_token()
                    await self.login()
                    continue
                response.raise_for_status()
                if not isinstance(body, dict):
                    raise CorosApiClientError("Training Hub returned an invalid response.")
                if body.get("result") != "0000":
                    raise CorosApiClientError(
                        f"Training Hub rejected the request: {body.get('message')}"
                    )
                return body.get("data")
        raise CorosApiClientError("Training Hub request failed")

    async def fetch_activity_fit_url(self, activity_id: str, sport_type: int) -> str:
        """Call POST /activity/detail/download to get the S3 FIT file URL."""
        url = f"{self.base_url}/activity/detail/download"
        params = {
            "labelId": activity_id,
            "sportType": sport_type,
            "fileType": 4,  # 4 = FIT format
        }

        async with httpx.AsyncClient(timeout=30) as client:
            headers = self._get_auth_headers()
            resp = await client.post(url, params=params, headers=headers)

            body = None
            is_token_invalid = resp.status_code == 401

            if resp.status_code == 200:
                body = resp.json()
                if body.get("result") != "0000" and "token" in body.get("message", "").lower():
                    is_token_invalid = True

            if is_token_invalid:
                logger.info("coros_api: refreshing token for FIT download URL")
                await self._invalidate_token()
                await self.login()
                headers = self._get_auth_headers()
                resp = await client.post(url, params=params, headers=headers)
                body = None

            resp.raise_for_status()
            res_json = body if body is not None else resp.json()
            if res_json.get("result") != "0000":
                raise CorosApiClientError(f"Failed to get FIT url: {res_json.get('message')}")

            file_url = res_json.get("data", {}).get("fileUrl")
            if not file_url:
                raise CorosApiClientError("Response missing fileUrl")
            return file_url

    async def fetch_activity_detail(self, activity_id: str, sport_type: int) -> dict:
        """Fetch an official Team API activity-detail payload."""
        url = f"{self.base_url}/activity/detail/query"
        params = {"labelId": activity_id, "sportType": sport_type}
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                response = await client.post(url, params=params, headers=self._get_auth_headers())
                response.raise_for_status()
                body = response.json()
        except httpx.HTTPError as exc:
            raise CorosApiClientError(f"Failed to fetch activity detail: {exc}") from exc
        if body.get("result") != "0000":
            raise CorosApiClientError(f"Failed to fetch activity detail: {body.get('message')}")
        data = body.get("data")
        return data if isinstance(data, dict) else {}

    async def fetch_activity_feel_type(self, activity_id: str, sport_type: int) -> int | None:
        """Fetch the end-of-activity RPE stored by COROS's Team API."""
        detail = await self.fetch_activity_detail(activity_id, sport_type)
        feel_info = detail.get("sportFeelInfo", {})
        feel_type = feel_info.get("feelType") if isinstance(feel_info, dict) else None
        return int(feel_type) if isinstance(feel_type, int) and 1 <= feel_type <= 5 else 0

    async def download_file(self, url: str) -> bytes:
        """Download raw binary file from URL (e.g. S3)."""
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            return resp.content

    async def fetch_daily_metrics(self, start_day: str, end_day: str) -> list[dict]:
        """Fetch daily health metrics for a date range (YYYYMMDD)."""
        url = f"{self.base_url}/analyse/dayDetail/query"
        params = {
            "startDay": start_day,
            "endDay": end_day,
        }

        async with httpx.AsyncClient(timeout=30) as client:
            body = await self._get_json(client, url, params)

            if body.get("result") != "0000":
                logger.warning(
                    "Failed to fetch daily details (might be normal if no data): "
                    f"{body.get('message')}"
                )
                return []

            return body.get("data", {}).get("dayList", [])

    async def fetch_analyse(self) -> dict:
        """Fetch summary and fitness estimates (VO2max, stamina)."""
        url = f"{self.base_url}/analyse/query"

        async with httpx.AsyncClient(timeout=30) as client:
            body = await self._get_json(client, url)

            if body.get("result") != "0000":
                return {}

            return body.get("data", {})

    async def fetch_dashboard(self) -> dict:
        """Fetch the live Training Hub dashboard, including recovery."""
        url = f"{self.base_url}/dashboard/query"

        async with httpx.AsyncClient(timeout=30) as client:
            body = await self._get_json(client, url)

            if body.get("result") != "0000":
                return {}

            return body.get("data", {})

    def _mobile_encrypt(self, plaintext: str, app_key: str) -> str:
        key = app_key.encode("ascii")
        data = plaintext.encode("utf-8")
        xored = bytes(b ^ key[i % len(key)] for i, b in enumerate(data))
        pad_len = 16 - (len(xored) % 16)
        padded = xored + bytes([pad_len] * pad_len)
        cipher = AES.new(key, AES.MODE_CBC, b"weloop3_2015_03#")
        return base64.b64encode(cipher.encrypt(padded)).decode("ascii")

    async def _load_cached_mobile_token(self) -> bool:
        if not self.redis:
            return False
        try:
            token = await self.redis.get(_REDIS_KEY_MOBILE_TOKEN)
            if token:
                self.mobile_access_token = token.decode() if isinstance(token, bytes) else token
                return True
        except Exception:
            logger.warning("redis_mobile_token_load_failed")
        return False

    async def _cache_mobile_token(self, token: str) -> None:
        if not self.redis:
            return
        try:
            await self.redis.setex(_REDIS_KEY_MOBILE_TOKEN, _MOBILE_TOKEN_TTL_SECONDS, token)
        except Exception:
            logger.warning("redis_mobile_token_cache_failed")

    async def mobile_login(self) -> None:
        """Authenticate with the Coros mobile API.

        Uses the cached Redis token if available.
        """
        if self.mobile_access_token:
            return

        if await self._load_cached_mobile_token():
            logger.debug("coros_mobile_login: using cached token")
            return

        if not self.email or not self.password:
            raise CorosApiClientError("Missing Coros credentials")

        url = f"{self.mobile_base_url}/coros/user/login"
        app_key = str(random.randint(1_000_000_000_000_000, 9_999_999_999_999_999))
        payload = {
            "account": self._mobile_encrypt(self.email, app_key) + "\\n",
            "accountType": 2,
            "appKey": app_key,
            "clientType": 2,
            "hasHrCalibrated": 0,
            "kbValidity": 0,
            "pwd": self._mobile_encrypt(self._md5(self.password), app_key) + "\\n",
            "region": "310|Europe/Berlin|US",
            "skipValidation": False,
        }
        headers = {
            "content-type": "application/json",
            "accept-encoding": "gzip",
            "user-agent": "okhttp/4.12.0",
        }

        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(url, json=payload, headers=headers)
            resp.raise_for_status()
            body = resp.json()
            if body.get("result") != "0000":
                raise CorosApiClientError("Mobile login failed")

            token = body.get("data", {}).get("accessToken")
            if not token:
                raise CorosApiClientError("Mobile login missing token")
            self.mobile_access_token = token

        await self._cache_mobile_token(self.mobile_access_token)
        logger.info("coros_mobile_login: fresh login completed, token cached")

    async def fetch_sleep(self, start_day: str, end_day: str) -> list[dict]:
        url = f"{self.mobile_base_url}/coros/data/statistic/daily"
        payload = {
            "allDeviceSleep": 1,
            "dataType": [5],
            "dataVersion": 0,
            "startTime": int(start_day),
            "endTime": int(end_day),
            "statisticType": 1,
        }
        headers = {
            "Content-Type": "application/json",
            "accesstoken": self.mobile_access_token,
        }

        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                url,
                params={"accessToken": self.mobile_access_token},
                json=payload,
                headers=headers,
            )
            if resp.status_code == 401:
                logger.warning("coros_mobile_api: received 401, invalidating token and retrying")
                self.mobile_access_token = None
                if self.redis:
                    try:
                        await self.redis.delete(_REDIS_KEY_MOBILE_TOKEN)
                    except Exception:
                        pass
                await self.mobile_login()
                headers["accesstoken"] = self.mobile_access_token
                resp = await client.post(
                    url,
                    params={"accessToken": self.mobile_access_token},
                    json=payload,
                    headers=headers,
                )
            resp.raise_for_status()
            body = resp.json()

            if body.get("result") != "0000":
                logger.warning(f"Failed to fetch sleep data: {body.get('message')}")
                return []

            return body.get("data", {}).get("statisticData", {}).get("dayDataList", [])
