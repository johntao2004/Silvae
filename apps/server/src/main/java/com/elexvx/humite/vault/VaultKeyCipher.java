package com.elexvx.humite.vault;

import com.elexvx.humite.common.ApiException;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.util.*;
import javax.crypto.Cipher;
import javax.crypto.spec.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/** Domain-separated instance key; ciphertext is bound to both user and canonical envelope. */
@Component
public class VaultKeyCipher {
    private static final String DOMAIN = "humite:vault:content-key:v1";

    private static final String LEGACY_DOMAIN = "silvae:vault:content-key:v1";

    private final SecretKeySpec key;
    private final SecretKeySpec legacyKey;

    public VaultKeyCipher(@Value("${humite.two-factor-encryption-key:}") String configured) {
        try {
            key = derive(configured, DOMAIN);
            legacyKey = derive(configured, LEGACY_DOMAIN);
        } catch (GeneralSecurityException e) { throw new IllegalStateException(e); }
    }

    private static SecretKeySpec derive(String configured, String domain) throws GeneralSecurityException {
        return configured == null || configured.isBlank() ? null : new SecretKeySpec(
                MessageDigest.getInstance("SHA-256").digest((domain + "\0" + configured).getBytes(StandardCharsets.UTF_8)), "AES");
    }

    private byte[] aad(String domain, UUID user, String envelope) {
        return (domain + ":" + user + ":" + envelope).getBytes(StandardCharsets.UTF_8);
    }

    private void requireKey() {
        if (key == null) throw ApiException.conflict("VAULT_KEY_UNAVAILABLE", "服务器加密密钥不可用，请联系站点所有者检查配置。");
    }

    public String encrypt(UUID user, String envelope, byte[] master) {
        requireKey();
        try {
            byte[] iv = new byte[12]; new SecureRandom().nextBytes(iv);
            var cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, key, new GCMParameterSpec(128, iv));
            cipher.updateAAD(aad(DOMAIN, user, envelope));
            return Base64.getEncoder().encodeToString(iv) + "." + Base64.getEncoder().encodeToString(cipher.doFinal(master));
        } catch (GeneralSecurityException e) { throw new IllegalStateException(e); }
    }

    public byte[] decrypt(UUID user, String envelope, String encrypted) {
        requireKey();
        try {
            return decryptWith(key, DOMAIN, user, envelope, encrypted);
        } catch (GeneralSecurityException | IllegalArgumentException | IndexOutOfBoundsException first) {
            try {
                // Existing unversioned records derive their key and AAD from the released domain.
                return decryptWith(legacyKey, LEGACY_DOMAIN, user, envelope, encrypted);
            } catch (GeneralSecurityException | IllegalArgumentException | IndexOutOfBoundsException e) {
                throw ApiException.conflict("VAULT_KEY_UNAVAILABLE", "无法读取加密内容密钥，请联系站点所有者检查服务器密钥；原有书籍未被改动。");
            }
        }
    }

    private byte[] decryptWith(SecretKeySpec selectedKey, String domain, UUID user, String envelope, String encrypted)
            throws GeneralSecurityException {
        if (encrypted == null) throw new IllegalArgumentException("Missing ciphertext");
        var parts = encrypted.split("\\.", 2);
        var cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, selectedKey, new GCMParameterSpec(128, Base64.getDecoder().decode(parts[0])));
        cipher.updateAAD(aad(domain, user, envelope));
        byte[] master = cipher.doFinal(Base64.getDecoder().decode(parts[1]));
        if (master.length != 32) {
            Arrays.fill(master, (byte) 0);
            throw new GeneralSecurityException();
        }
        return master;
    }
}
