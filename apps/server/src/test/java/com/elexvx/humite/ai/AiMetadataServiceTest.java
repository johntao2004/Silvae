// 验证兼容 OpenAI 的结构化候选解析及待审核标记，不把模型建议直接视为已应用元数据。
// Checks OpenAI-compatible candidate parsing and review-required status rather than treating suggestions as applied metadata.
package com.elexvx.humite.ai;

import static com.elexvx.humite.ingestion.upload.BookUploadModels.MetadataSource;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.elexvx.humite.common.ApiException;
import com.sun.net.httpserver.HttpServer;
import com.elexvx.humite.config.HumiteProperties;
import com.elexvx.humite.config.HumiteProperties.AiProvider;
import com.elexvx.humite.config.HumiteProperties.AiProviderType;
import com.elexvx.humite.ingestion.upload.BookUploadModels.MetadataDraft;
import com.elexvx.humite.ingestion.upload.BookUploadRepository;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

class AiMetadataServiceTest {
    @Test
    void preservesSameTitleEditionsParsesEditionFieldsAndRefreshBypassesCache() throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        AtomicInteger requests = new AtomicInteger();
        server.createContext("/v1/chat/completions", exchange -> {
            requests.incrementAndGet();
            exchange.getRequestBody().readAllBytes();
            byte[] response = """
                    {"choices":[{"message":{"content":"{\\"candidates\\":[{\\"title\\":\\"百年孤独\\",\\"authors\\":[\\"加西亚·马尔克斯\\"],\\"publisher\\":\\"甲出版社\\",\\"publishedDate\\":\\"1967\\",\\"isbn\\":\\"9780000000001\\",\\"edition\\":\\"第一版\\",\\"language\\":\\"es\\",\\"sourceUrl\\":\\"https://openlibrary.org/books/OL1M\\",\\"confidence\\":0.94,\\"reason\\":\\"有来源记录\\"},{\\"title\\":\\"百年孤独\\",\\"authors\\":[\\"加西亚·马尔克斯\\"],\\"publisher\\":\\"乙出版社\\",\\"publishedDate\\":\\"1972\\",\\"isbn\\":\\"9780000000002\\",\\"edition\\":\\"修订版\\",\\"language\\":\\"es\\",\\"sourceUrl\\":\\"javascript:alert(1)\\",\\"confidence\\":0.91,\\"reason\\":\\"有版本记录\\"}]}"}}]}
                    """.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, response.length);
            try (var output = exchange.getResponseBody()) { output.write(response); }
        });
        server.start();
        try {
            String baseUrl = "http://127.0.0.1:" + server.getAddress().getPort() + "/v1";
            var provider = new AiProvider("local", "本地兼容平台", AiProviderType.OPENAI_COMPATIBLE, true, baseUrl, "", "test-model");
            var properties = new HumiteProperties(null, null, null, null, null, null, null, null, null, null,
                    new HumiteProperties.Ai(true, false, 4, java.time.Duration.ofSeconds(3), List.of(provider), "test-ai-settings-key"));
            var uploads = mock(BookUploadRepository.class);
            AtomicReference<String> cache = new AtomicReference<>();
            when(uploads.cached(anyString(), anyString())).thenAnswer(invocation -> cache.get());
            doAnswer(invocation -> { cache.set(invocation.getArgument(2)); return null; })
                    .when(uploads).cache(org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.anyString(),
                            org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.any());
            var service = new AiMetadataService(properties, uploads, new JsonMapper());
            var draft = new MetadataDraft("百年孤独", null, List.of("未知作者"), List.of(), "zh-CN", null, null,
                    null, null, null, null, List.of(), null, null, Map.of(), "未知作者/百年孤独.epub");

            var result = service.match(draft, List.of(), null);

            assertEquals(2, result.candidates().size());
            var candidate = result.candidates().getFirst();
            assertEquals(MetadataSource.AI, candidate.provider());
            assertEquals("本地兼容平台", candidate.providerLabel());
            assertEquals("百年孤独", candidate.title());
            assertEquals(List.of("加西亚·马尔克斯"), candidate.authors());
            assertEquals("第一版", candidate.edition());
            assertEquals("es", candidate.language());
            assertEquals("https://openlibrary.org/books/OL1M", candidate.sourceUrl());
            assertTrue(candidate.requiresReview());
            assertNull(result.candidates().get(1).sourceUrl(), "unsafe source URLs must be discarded");

            service.match(draft, List.of(), null);
            assertEquals(1, requests.get(), "a normal match should use the stored AI response");
            service.match(draft, List.of(), null, true);
            assertEquals(2, requests.get(), "refresh must invoke the AI provider again");
        } finally {
            server.stop(0);
        }
    }

    @Test
    void listsModelsAcrossProvidersWithOriginBoundKeyReuseAndOllamaFallback() throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        AtomicReference<String> openAiAuth = new AtomicReference<>();
        AtomicReference<String> anthropicKey = new AtomicReference<>();
        AtomicReference<String> anthropicVersion = new AtomicReference<>();
        AtomicReference<String> geminiKey = new AtomicReference<>();
        server.createContext("/openai/v1/models", exchange -> {
            openAiAuth.set(exchange.getRequestHeaders().getFirst("Authorization"));
            json(exchange, 200, "{\"data\":[{\"id\":\"gpt-4o-mini\"},{\"id\":\"gpt-5.1\",\"display_name\":\"GPT-5.1\"}]}");
        });
        server.createContext("/ollama/v1/models", exchange -> json(exchange, 404, "{}"));
        server.createContext("/api/tags", exchange ->
                json(exchange, 200, "{\"models\":[{\"name\":\"qwen3:latest\",\"model\":\"qwen3:latest\"},{\"name\":\"llama3.3\"}]}"));
        server.createContext("/v1/models", exchange -> {
            anthropicKey.set(exchange.getRequestHeaders().getFirst("x-api-key"));
            anthropicVersion.set(exchange.getRequestHeaders().getFirst("anthropic-version"));
            json(exchange, 200, "{\"data\":[{\"id\":\"claude-sonnet-4-6\",\"display_name\":\"Claude Sonnet 4.6\"}]}");
        });
        server.createContext("/gemini/v1beta/models", exchange -> {
            geminiKey.set(exchange.getRequestHeaders().getFirst("x-goog-api-key"));
            json(exchange, 200, "{\"models\":[{\"name\":\"models/gemini-2.5-flash\",\"displayName\":\"Gemini 2.5 Flash\"}]}");
        });
        server.start();
        try {
            String origin = "http://127.0.0.1:" + server.getAddress().getPort();
            var stored = List.of(
                    new AiProvider("openai", "OpenAI", AiProviderType.OPENAI_COMPATIBLE, true,
                            origin + "/openai/v1", "stored-openai-key", "gpt-4o-mini"),
                    new AiProvider("anthropic", "Anthropic", AiProviderType.ANTHROPIC, true,
                            "https://api.anthropic.com", "stored-anthropic-key", "claude-sonnet-4-6"));
            var properties = new HumiteProperties(null, null, null, null, null, null, null, null, null, null,
                    new HumiteProperties.Ai(false, true, 4, Duration.ofSeconds(3), stored, "test-key"));
            var service = new AiMetadataService(properties, mock(BookUploadRepository.class), new JsonMapper());

            // Blank apiKey + matching origin reuses stored key
            var openAiModels = service.listModels(new AiMetadataService.FetchModelsInput(
                    "openai", "OPENAI_COMPATIBLE", origin + "/openai/v1", ""));
            assertEquals("Bearer stored-openai-key", openAiAuth.get());
            assertEquals(List.of("gpt-4o-mini", "gpt-5.1"),
                    openAiModels.models().stream().map(AiMetadataService.ModelOption::id).toList());
            assertEquals("GPT-5.1", openAiModels.models().get(1).label());

            // Ollama /v1/models 404 falls back to {origin}/api/tags
            var ollamaModels = service.listModels(new AiMetadataService.FetchModelsInput(
                    "ollama", "OPENAI_COMPATIBLE", origin + "/ollama/v1", ""));
            assertEquals("ollama", ollamaModels.source());
            assertEquals(List.of("qwen3:latest", "llama3.3"),
                    ollamaModels.models().stream().map(AiMetadataService.ModelOption::id).toList());

            // Origin changed from https://api.anthropic.com -> http://127.0.0.1 with blank key MUST NOT reuse stored key
            service.listModels(new AiMetadataService.FetchModelsInput("anthropic", "ANTHROPIC", origin, ""));
            assertNull(anthropicKey.get());
            assertEquals("2023-06-01", anthropicVersion.get());

            // Explicit key is sent for Anthropic & Gemini
            var anthropicModels = service.listModels(new AiMetadataService.FetchModelsInput(
                    "anthropic", "ANTHROPIC", origin + "/ignored", "explicit-anthropic-key"));
            assertEquals("explicit-anthropic-key", anthropicKey.get());
            assertEquals("Claude Sonnet 4.6", anthropicModels.models().getFirst().label());

            var geminiModels = service.listModels(new AiMetadataService.FetchModelsInput(
                    "gemini", "GEMINI", origin + "/gemini/v1beta", "explicit-gemini-key"));
            assertEquals("explicit-gemini-key", geminiKey.get());
            assertEquals("gemini-2.5-flash", geminiModels.models().getFirst().id());
            assertEquals("Gemini 2.5 Flash", geminiModels.models().getFirst().label());
        } finally {
            server.stop(0);
        }
    }

    @Test
    void rejectsRedirectsPrivateIpsNonHttpsAndOversizedResponses() throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        AtomicInteger redirectedHits = new AtomicInteger();
        server.createContext("/redirect/models", exchange -> {
            exchange.getResponseHeaders().add("Location", "/target");
            exchange.sendResponseHeaders(302, -1);
            exchange.close();
        });
        server.createContext("/target", exchange -> {
            redirectedHits.incrementAndGet();
            json(exchange, 200, "{}");
        });
        server.createContext("/huge/models", exchange -> {
            byte[] payload = ("{\"data\":[{\"id\":\"" + "a".repeat(4 * 1024 * 1024 + 32) + "\"}]}")
                    .getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, payload.length);
            try (var output = exchange.getResponseBody()) {
                output.write(payload);
            }
        });
        server.start();
        try {
            String origin = "http://127.0.0.1:" + server.getAddress().getPort();
            var properties = new HumiteProperties(null, null, null, null, null, null, null, null, null, null,
                    new HumiteProperties.Ai(true, true, 4, Duration.ofSeconds(3), List.of(), "test-key"));
            var service = new AiMetadataService(properties, mock(BookUploadRepository.class), new JsonMapper());

            // Redirect.NEVER must not follow 302
            assertThrows(ApiException.class, () -> service.listModels(
                    new AiMetadataService.FetchModelsInput("openai", "OPENAI_COMPATIBLE", origin + "/redirect", "")));
            assertEquals(0, redirectedHits.get());

            // Bounded 4 MiB response guard
            assertThrows(ApiException.class, () -> service.listModels(
                    new AiMetadataService.FetchModelsInput("openai", "OPENAI_COMPATIBLE", origin + "/huge", "")));

            // Non-loopback HTTP & private/CGNAT/ULA IPs blocked before sending
            for (String blocked : List.of(
                    "http://api.openai.com/v1",
                    "https://user:pass@api.openai.com/v1",
                    "https://10.0.0.5/v1",
                    "https://169.254.169.254/latest",
                    "https://100.64.0.1/v1",
                    "https://[fc00::1]/v1")) {
                ApiException error = assertThrows(ApiException.class, () -> service.validateOutboundUri(URI.create(blocked)));
                assertEquals("AI_BASE_URL_INVALID", error.code());
            }

            // DNS-resolved private/CGNAT/ULA/loopback blocked for external hostnames
            HttpClient unusedHttp = mock(HttpClient.class);
            for (String resolvedIp : List.of("127.0.0.1", "10.0.0.1", "169.254.169.254", "100.64.0.1", "fc00::1")) {
                var dnsChecked = new AiMetadataService(properties, mock(BookUploadRepository.class), new JsonMapper(),
                        unusedHttp, host -> new InetAddress[]{InetAddress.getByName(resolvedIp)});
                ApiException error = assertThrows(ApiException.class,
                        () -> dnsChecked.validateOutboundUri(URI.create("https://rebind.example/v1/models")));
                assertEquals("AI_BASE_URL_INVALID", error.code());
            }
        } finally {
            server.stop(0);
        }
    }

    private static void json(com.sun.net.httpserver.HttpExchange exchange, int status, String body)
            throws java.io.IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().add("Content-Type", "application/json");
        exchange.sendResponseHeaders(status, bytes.length);
        try (var output = exchange.getResponseBody()) {
            output.write(bytes);
        }
    }
}
