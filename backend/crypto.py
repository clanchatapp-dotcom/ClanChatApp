"""
Server-side AES-256 encryption for DMs.
Keys are stored securely on the server (not exposed to client).
This is Telegram-style encryption (server holds keys), not E2E.
"""

import os
from cryptography.fernet import Fernet

# Server encryption key (load from secure environment)
ENCRYPTION_KEY = os.environ.get("DM_ENCRYPTION_KEY")

if not ENCRYPTION_KEY:
    # Generate a key for first-time setup (dev only)
    key = Fernet.generate_key()
    print(f"⚠️  Set DM_ENCRYPTION_KEY={key.decode()}")
    ENCRYPTION_KEY = key.decode()

cipher = Fernet(ENCRYPTION_KEY.encode() if isinstance(ENCRYPTION_KEY, str) else ENCRYPTION_KEY)


def encrypt_message(plaintext: str) -> str:
    """Encrypt message for storage at rest."""
    if not plaintext:
        return ""
    encrypted = cipher.encrypt(plaintext.encode())
    return encrypted.decode()  # Store as string


def decrypt_message(ciphertext: str) -> str:
    """Decrypt message (admin viewing only)."""
    if not ciphertext:
        return ""
    try:
        decrypted = cipher.decrypt(ciphertext.encode())
        return decrypted.decode()
    except Exception as e:
        print(f"Decryption failed: {e}")
        return "[unable to decrypt]"


def is_encrypted(text: str) -> bool:
    """Check if text looks encrypted (basic heuristic)."""
    if not text:
        return False
    try:
        # Encrypted text will fail to decode as plain UTF-8
        cipher.decrypt(text.encode())
        return True
    except:
        return False
