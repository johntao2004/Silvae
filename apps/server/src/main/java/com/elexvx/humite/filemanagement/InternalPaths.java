package com.elexvx.humite.filemanagement;

import java.util.Set;

/** New writes use Humite paths; persisted legacy paths keep referring to their original files. */
public final class InternalPaths {
    private InternalPaths() {}
    public static final Set<String> DIRECTORIES = Set.of(
            ".humite-trash", ".humite-staging", ".humite-versions", ".humite-cache", ".humite-assets",
            ".silvae-trash", ".silvae-staging", ".silvae-versions", ".silvae-cache", ".silvae-assets");

    public static boolean startsWith(String path, String humitePrefix) {
        return path != null && (path.startsWith(humitePrefix)
                || path.startsWith(humitePrefix.replace(".humite-", ".silvae-")));
    }
}
