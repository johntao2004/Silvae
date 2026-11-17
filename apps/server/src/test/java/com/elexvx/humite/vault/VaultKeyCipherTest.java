package com.elexvx.humite.vault;

import static org.assertj.core.api.Assertions.*;
import com.elexvx.humite.common.ApiException;
import java.util.*;
import org.junit.jupiter.api.Test;

class VaultKeyCipherTest {
    @Test void ciphertextIsRandomizedAndBoundToInstanceUserAndEnvelope() {
        var cipher = new VaultKeyCipher("isolated-test-key");
        var owner = UUID.randomUUID(); byte[] master = new byte[32]; new Random(31).nextBytes(master);
        String encrypted = cipher.encrypt(owner, "canonical-envelope", master);
        assertThat(encrypted).isNotEqualTo(cipher.encrypt(owner, "canonical-envelope", master));
        assertThat(encrypted).doesNotContain(Base64.getEncoder().encodeToString(master));
        assertThat(cipher.decrypt(owner, "canonical-envelope", encrypted)).isEqualTo(master);
        assertThatThrownBy(() -> cipher.decrypt(UUID.randomUUID(), "canonical-envelope", encrypted)).isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> cipher.decrypt(owner, "changed-envelope", encrypted)).isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> new VaultKeyCipher("different-instance").decrypt(owner, "canonical-envelope", encrypted)).isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> new VaultKeyCipher("").encrypt(owner, "canonical-envelope", master)).isInstanceOf(ApiException.class);
        assertThat(new VaultKeyService.Access("SECRET", "envelope", 1).toString()).doesNotContain("SECRET");
        assertThat(new VaultController.KeyMigration("SECRET", 1).toString()).doesNotContain("SECRET");
    }
    @Test void readsReleasedCiphertextWithoutLosingIdentityOrInstanceBinding() {
        var owner = UUID.fromString("11111111-2222-3333-4444-555555555555");
        String legacy = "BwcHBwcHBwcHBwcH.I+KLoeqbCaikPkLhmjn7vJE1gq1l2sSC7Rr4nHcSvy9frvmdwRa3w1yy24fIieXN";
        byte[] expected = new byte[32];for (int i=0;i<32;i++) expected[i]=(byte)i;
        var cipher = new VaultKeyCipher("isolated-test-key");
        assertThat(cipher.decrypt(owner,"canonical-envelope",legacy)).isEqualTo(expected);
        assertThatThrownBy(() -> cipher.decrypt(UUID.randomUUID(),"canonical-envelope",legacy)).isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> cipher.decrypt(owner,"changed-envelope",legacy)).isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> new VaultKeyCipher("different-instance").decrypt(owner,"canonical-envelope",legacy)).isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> cipher.decrypt(owner,"canonical-envelope",legacy.substring(0,legacy.length()-4))).isInstanceOf(ApiException.class);
    }
}
