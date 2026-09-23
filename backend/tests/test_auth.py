import os
os.environ["JWT_SECRET_KEY"]="test-secret-do-not-use"

from datetime import timedelta
from app.core.security import hash_password, verify_password, create_token, decode_token

def test_password_hashing():
    hashed=hash_password("correct horse battery staple")
    assert hashed != "correct horse battery staple"
    assert verify_password("correct horse battery staple", hashed)
    assert not verify_password("wrong", hashed)

def test_access_token_type_and_payload():
    token=create_token("user-1", "STUDENT", "access", timedelta(minutes=5))
    payload=decode_token(token,"access")
    assert payload["sub"]=="user-1"
    assert payload["role"]=="STUDENT"
    assert payload["type"]=="access"

def test_refresh_token_cannot_be_used_as_access():
    from jwt import InvalidTokenError
    token=create_token("user-1", "STUDENT", "refresh", timedelta(days=1))
    try:
        decode_token(token,"access")
        assert False
    except InvalidTokenError:
        assert True
