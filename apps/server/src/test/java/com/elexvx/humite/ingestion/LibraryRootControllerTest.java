package com.elexvx.humite.ingestion;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.elexvx.humite.common.ApiExceptionHandler;
import com.elexvx.humite.filemanagement.ContentStorageService;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class LibraryRootControllerTest {
    @Test
    void invalidLocationArgumentDelegatesToGlobalProblemDetailHandler() throws Exception {
        var registration = mock(LibraryRootRegistrationService.class);
        when(registration.preview("/bad/location")).thenThrow(new IllegalArgumentException("目录不在允许范围内"));
        var controller = new LibraryRootController(
                mock(LibraryRootRepository.class),
                registration,
                mock(LibraryRootCapabilityService.class),
                mock(ContentStorageService.class));
        var mvc = MockMvcBuilders.standaloneSetup(controller)
                .setControllerAdvice(new ApiExceptionHandler())
                .build();

        mvc.perform(post("/api/v1/library-roots/preview")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"path\":\"/bad/location\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_LIBRARY_LOCATION"))
                .andExpect(jsonPath("$.detail").value("目录不在允许范围内"))
                .andExpect(jsonPath("$.title").value("请求无法完成"));
    }

    @Test
    void realRegistrationServicePropagatesForbiddenProblemDetail() throws Exception {
        var controller = new LibraryRootController(
                mock(LibraryRootRepository.class),
                new LibraryRootRegistrationService(),
                mock(LibraryRootCapabilityService.class),
                mock(ContentStorageService.class));
        var mvc = MockMvcBuilders.standaloneSetup(controller)
                .setControllerAdvice(new ApiExceptionHandler())
                .build();

        mvc.perform(post("/api/v1/library-roots/preview")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"path\":\"/library\"}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("LIBRARY_ROOT_REGISTRATION_DISABLED"));
    }
}
