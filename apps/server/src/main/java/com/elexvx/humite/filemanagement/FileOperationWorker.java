package com.elexvx.humite.filemanagement;

import org.springframework.context.annotation.Profile;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
@Profile("worker")
public class FileOperationWorker {
    private final FileOperationRepository operations;
    private final FileTransactionExecutor executor;

    public FileOperationWorker(FileOperationRepository operations, FileTransactionExecutor executor) {
        this.operations = operations;
        this.executor = executor;
    }

    // 仅 worker Profile 轮询领取任务；轮询间隔由 humite.worker.poll-delay 控制。
    // Only the worker profile polls for jobs using humite.worker.poll-delay.
    @Scheduled(fixedDelayString = "${humite.worker.poll-delay:1s}")
    public void poll() {
        operations.claimNext().ifPresent(executor::execute);
    }
}
