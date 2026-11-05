with open('Backend/main.py', 'r', encoding='utf-8') as f:
    text = f.read().replace('\r\n', '\n')

old_code = """def _preview_url_is_allowed(url: str) -> bool:
    try:
        parsed = urlsplit(url)
    except ValueError:
        return False

    if parsed.scheme.casefold() not in ("http", "https") or not parsed.netloc:
        return False

    target = _preview_authority_key(parsed.netloc)
    allowed = {
        key
        for item in os.getenv("K6_PREVIEW_ALLOWED_HOSTS", "").split(",")
        if (key := _preview_authority_key(item.strip()))
    }
    return target is not None and target in allowed"""

new_code = """def _preview_url_is_allowed(url: str) -> bool:
    try:
        parsed = urlsplit(url)
    except ValueError:
        return False

    if parsed.scheme.casefold() not in ("http", "https") or not parsed.netloc:
        return False

    allowed_env = os.getenv("K6_PREVIEW_ALLOWED_HOSTS", "").strip()
    if not allowed_env:
        return True

    target = _preview_authority_key(parsed.netloc)
    allowed = {
        key
        for item in allowed_env.split(",")
        if (key := _preview_authority_key(item.strip()))
    }
    return target is not None and target in allowed"""

assert old_code in text, "old_code not found in main.py"
text = text.replace(old_code, new_code)

with open('Backend/main.py', 'w', encoding='utf-8') as f:
    f.write(text)

print("Updated _preview_url_is_allowed in Backend/main.py")
