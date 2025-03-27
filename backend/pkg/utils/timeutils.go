package utils

import (
	"fmt"
	"strconv"
	"time"
)

// FormatDuration formata uma duração para exibição amigável
func FormatDuration(d time.Duration) string {
	d = d.Round(time.Second)

	h := d / time.Hour
	d -= h * time.Hour

	m := d / time.Minute
	d -= m * time.Minute

	s := d / time.Second

	if h > 0 {
		return fmt.Sprintf("%dh %dm %ds", h, m, s)
	} else if m > 0 {
		return fmt.Sprintf("%dm %ds", m, s)
	}
	return fmt.Sprintf("%ds", s)
}

// FormatTimestamp formata um timestamp Unix (em milissegundos) para exibição
func FormatTimestamp(timestamp int64) string {
	t := time.Unix(0, timestamp*int64(time.Millisecond))
	return t.Format("2006-01-02 15:04:05")
}

// FormatDateTime formata um time.Time para exibição
func FormatDateTime(t time.Time) string {
	return t.Format("2006-01-02 15:04:05")
}

// FormatDateTimeMs formata um time.Time para exibição com milissegundos
func FormatDateTimeMs(t time.Time) string {
	return t.Format("2006-01-02 15:04:05.000")
}

// TimeAgo retorna uma string descrevendo quanto tempo passou desde t
func TimeAgo(t time.Time) string {
	duration := time.Since(t)

	seconds := int(duration.Seconds())
	if seconds < 60 {
		return fmt.Sprintf("%d segundos atrás", seconds)
	}

	minutes := seconds / 60
	if minutes < 60 {
		return fmt.Sprintf("%d minutos atrás", minutes)
	}

	hours := minutes / 60
	if hours < 24 {
		return fmt.Sprintf("%d horas atrás", hours)
	}

	days := hours / 24
	if days < 30 {
		return fmt.Sprintf("%d dias atrás", days)
	}

	months := days / 30
	if months < 12 {
		return fmt.Sprintf("%d meses atrás", months)
	}

	years := months / 12
	return fmt.Sprintf("%d anos atrás", years)
}

// ParseTimestamp parse a timestamp in different formats
func ParseTimestamp(timestamp string) (time.Time, error) {
	// Try parsing as Unix timestamp (seconds)
	if sec, err := strconv.ParseInt(timestamp, 10, 64); err == nil {
		// If it's a large number, it's likely milliseconds
		if sec > 1000000000000 {
			return time.Unix(0, sec*int64(time.Millisecond)), nil
		}
		return time.Unix(sec, 0), nil
	}

	// Try common formats
	formats := []string{
		"2006-01-02T15:04:05Z",      // ISO8601 UTC
		"2006-01-02T15:04:05-07:00", // ISO8601 with timezone
		"2006-01-02 15:04:05",       // Common format
		"2006-01-02",                // Just date
		"15:04:05",                  // Just time
		time.RFC3339,
		time.RFC3339Nano,
	}

	for _, format := range formats {
		if t, err := time.Parse(format, timestamp); err == nil {
			return t, nil
		}
	}

	return time.Time{}, fmt.Errorf("formato de timestamp não reconhecido: %s", timestamp)
}

// Yesterday returns yesterday at the same time
func Yesterday() time.Time {
	return time.Now().AddDate(0, 0, -1)
}

// Tomorrow returns tomorrow at the same time
func Tomorrow() time.Time {
	return time.Now().AddDate(0, 0, 1)
}

// StartOfDay returns the start of the day for the given time
func StartOfDay(t time.Time) time.Time {
	year, month, day := t.Date()
	return time.Date(year, month, day, 0, 0, 0, 0, t.Location())
}

// EndOfDay returns the end of the day for the given time
func EndOfDay(t time.Time) time.Time {
	year, month, day := t.Date()
	return time.Date(year, month, day, 23, 59, 59, 999999999, t.Location())
}

// StartOfWeek returns the start of the week for the given time
func StartOfWeek(t time.Time) time.Time {
	// Calculate days since last Sunday (or Monday for different week start)
	weekday := int(t.Weekday())
	return StartOfDay(t.AddDate(0, 0, -weekday))
}

// EndOfWeek returns the end of the week for the given time
func EndOfWeek(t time.Time) time.Time {
	// Calculate days until next Saturday (or Sunday for different week end)
	weekday := int(t.Weekday())
	daysUntilEndOfWeek := 6 - weekday
	return EndOfDay(t.AddDate(0, 0, daysUntilEndOfWeek))
}

// StartOfMonth returns the start of the month for the given time
func StartOfMonth(t time.Time) time.Time {
	year, month, _ := t.Date()
	return time.Date(year, month, 1, 0, 0, 0, 0, t.Location())
}

// EndOfMonth returns the end of the month for the given time
func EndOfMonth(t time.Time) time.Time {
	year, month, _ := t.Date()
	// Go to the first day of the next month, then go back one day
	return time.Date(year, month+1, 1, 23, 59, 59, 999999999, t.Location()).AddDate(0, 0, -1)
}
