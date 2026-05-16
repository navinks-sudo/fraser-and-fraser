"""Password hashing + JWT helpers.

We bypass passlib and use the ``bcrypt`` library directly. passlib's
``CryptContext`` performs a "wrap bug" self-test on first use that hashes a
73-byte secret — newer bcrypt versions reject any password longer than 72
bytes outright, which crashes the self-test on Python 3.14 with a confusing
500 error during login. Using bcrypt directly avoids the whole detection path.
"""
from datetime import datetime, timedelta
from typing import Optional

import bcrypt
from jose import jwt

from backend.config import settings


# bcrypt's max secret length. Anything longer is silently truncated below to
# match the historical passlib semantics.
_BCRYPT_MAX_BYTES = 72


def _encode(password: str) -> bytes:
    encoded = password.encode("utf-8")
    if len(encoded) > _BCRYPT_MAX_BYTES:
        encoded = encoded[:_BCRYPT_MAX_BYTES]
    return encoded


def get_password_hash(password: str) -> str:
    salt = bcrypt.gensalt(rounds=12)
    return bcrypt.hashpw(_encode(password), salt).decode("utf-8")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        return bcrypt.checkpw(_encode(plain_password), hashed_password.encode("utf-8"))
    except (ValueError, TypeError):
        return False


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + (
        expires_delta or timedelta(minutes=settings.access_token_expire_minutes)
    )
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, settings.jwt_secret, algorithm=settings.jwt_algorithm)
