package com.elexvx.humite.reading;

import com.elexvx.humite.catalog.BookRepository;
import java.time.Clock;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Private book overview; catalog queries cross modules only through the public book gateway. */
@Service
public class ReadingOverviewService {
    private final ReadingRepository reading;
    private final BookRepository books;
    private final Clock clock;

    @Autowired
    public ReadingOverviewService(ReadingRepository reading, BookRepository books) {
        this(reading, books, Clock.systemDefaultZone());
    }

    ReadingOverviewService(ReadingRepository reading, BookRepository books, Clock clock) {
        this.reading = reading;
        this.books = books;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public Overview current(UUID userId) {
        var today = LocalDate.now(clock);
        var stats = reading.weeklyStats(userId, today);
        var start = stats.weekStart().atStartOfDay(clock.getZone()).toOffsetDateTime();
        var end = stats.weekEnd().plusDays(1).atStartOfDay(clock.getZone()).toOffsetDateTime();
        var featured = books.newestAddedBetween(userId, start, end).orElse(null);
        var recentIds = books.recentlyReadIds(userId);
        var recentBooks = books.findSummaries(userId, recentIds);
        var recentPositions = reading.findAll(userId, recentIds);
        var recent = recentIds.stream().flatMap(id -> {
            var book = recentBooks.get(id);
            var position = recentPositions.get(id);
            return book != null && position != null
                    ? java.util.stream.Stream.of(new RecentReading(book, position))
                    : java.util.stream.Stream.empty();
        }).toList();
        return new Overview(today, featured, recent, stats);
    }

    public record RecentReading(BookRepository.BookSummary book, ReadingRepository.ReadingPosition position) {}
    public record Overview(LocalDate today, BookRepository.BookSummary featuredBook,
                           List<RecentReading> recentReading, ReadingRepository.WeeklyReadingStats stats) {}
}
