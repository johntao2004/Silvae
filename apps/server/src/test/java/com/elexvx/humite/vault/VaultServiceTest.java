package com.elexvx.humite.vault;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.elexvx.humite.common.ApiException;
import com.elexvx.humite.filemanagement.infrastructure.PrivateContentStore;
import com.elexvx.humite.users.HumiteUser;
import com.elexvx.humite.users.UserRepository;
import com.elexvx.humite.users.UserRole;
import com.elexvx.humite.users.UserStatus;
import java.security.Principal;
import java.util.Optional;
import java.util.UUID;
import org.jooq.DSLContext;
import org.jooq.Record;
import org.junit.jupiter.api.Test;

class VaultServiceTest {
    @Test
    void updateConfigRejectsMalformedEnvelopeBeforeTouchingDatabase() {
        DSLContext db = mock(DSLContext.class);
        UserRepository users = mock(UserRepository.class);
        VaultService service = new VaultService(db, users, mock(PrivateContentStore.class));
        Principal principal = () -> "alice";

        for (String invalid : new String[]{"", "   ", "{not-json", "{} trailing"}) {
            ApiException error = assertThrows(ApiException.class, () -> service.updateConfig(invalid, 0, principal));
            assertEquals("ENVELOPE_INVALID", error.code());
        }
        verifyNoInteractions(db);
    }

    @Test
    void createObjectSerializesQuotaCheckWithAdvisoryTransactionLock() {
        DSLContext db = mock(DSLContext.class);
        UserRepository users = mock(UserRepository.class);
        UUID userId = UUID.randomUUID();
        when(users.findByUsername("alice")).thenReturn(Optional.of(
                new HumiteUser(userId, "alice", "Alice", "hash", UserRole.MEMBER, UserStatus.ACTIVE, false, null, null)));
        Record quota = mock(Record.class);
        when(quota.get("total", Long.class)).thenReturn(0L);
        when(quota.get("objects", Long.class)).thenReturn(0L);
        when(db.fetchOne(anyString(), eq(userId))).thenReturn(quota);

        VaultService service = new VaultService(db, users, mock(PrivateContentStore.class));
        UUID objectId = UUID.randomUUID();
        service.createObject(objectId, "{\"title\":\"secret\"}", "{}", 2, () -> "alice");

        verify(db).execute("select pg_advisory_xact_lock(hashtext('vault:' || ?))", userId.toString());
    }
}
