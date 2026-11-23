package com.elexvx.humite.catalog.terms;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.elexvx.humite.auth.RolePermissionService;
import com.elexvx.humite.catalog.BookMetadataRepository;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.annotation.EnableTransactionManagement;
import org.springframework.transaction.support.AbstractPlatformTransactionManager;
import org.springframework.transaction.support.DefaultTransactionStatus;
import org.springframework.transaction.support.TransactionSynchronizationManager;

class MetadataTermServiceTest {
    @Test
    void canonicalizeMetadataTermsExecutesInsideSingleSpringTransactionWithoutSelfInvocationBypass() {
        try (var context = new AnnotationConfigApplicationContext(TestConfig.class)) {
            var service = context.getBean(MetadataTermService.class);
            var repository = context.getBean(MetadataTermRepository.class);
            var txManager = context.getBean(RecordingTransactionManager.class);
            List<Boolean> txActiveDuringEnsure = new ArrayList<>();

            when(repository.ensure(any(), anyString(), anyString())).thenAnswer(invocation -> {
                txActiveDuringEnsure.add(TransactionSynchronizationManager.isActualTransactionActive());
                MetadataTermKind kind = invocation.getArgument(0);
                String value = invocation.getArgument(1);
                String label = invocation.getArgument(2);
                return new MetadataTerm("term-" + value, kind, value, label);
            });

            var patch = new BookMetadataRepository.MetadataPatch(
                    "Title", null, List.of("Author"), List.of(), "zh", null, null, null, null,
                    "Series Name", null, List.of("Tag One", "Tag Two"), List.of(),
                    new String[] {"series", "tags"}, null, null);

            var canonical = service.canonicalizeMetadataTerms(patch);

            assertThat(canonical.series()).isEqualTo("Series Name");
            assertThat(canonical.tags()).containsExactly("Tag One", "Tag Two");
            assertThat(txManager.begun).isEqualTo(1);
            assertThat(txManager.committed).isEqualTo(1);
            assertThat(txActiveDuringEnsure).containsExactly(true, true, true);
        }
    }

    @Configuration
    @EnableTransactionManagement
    static class TestConfig {
        @Bean RecordingTransactionManager transactionManager() { return new RecordingTransactionManager(); }
        @Bean MetadataTermRepository repository() { return mock(MetadataTermRepository.class); }
        @Bean RolePermissionService permissions() { return mock(RolePermissionService.class); }
        @Bean MetadataTermService service(MetadataTermRepository repository, RolePermissionService permissions) {
            return new MetadataTermService(repository, permissions);
        }
    }

    static class RecordingTransactionManager extends AbstractPlatformTransactionManager {
        int begun;
        int committed;

        @Override protected Object doGetTransaction() { return new Object(); }
        @Override protected void doBegin(Object transaction, TransactionDefinition definition) { begun++; }
        @Override protected void doCommit(DefaultTransactionStatus status) { committed++; }
        @Override protected void doRollback(DefaultTransactionStatus status) {}
    }
}
