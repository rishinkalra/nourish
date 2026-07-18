import Foundation

public enum NourishFormatting {
    public static func integer(_ value: Int, locale: Locale = .autoupdatingCurrent) -> String {
        value.formatted(.number.locale(locale))
    }

    public static func decimal(_ value: Decimal, locale: Locale = .autoupdatingCurrent) -> String {
        value.formatted(
            .number
                .precision(.fractionLength(0...2))
                .locale(locale)
        )
    }

    public static func energyKilocalories(
        _ value: Double,
        locale: Locale = .autoupdatingCurrent
    ) -> String {
        Measurement(value: value, unit: UnitEnergy.kilocalories).formatted(
            .measurement(width: .abbreviated, usage: .food)
                .locale(locale)
        )
    }

    public static func massGrams(
        _ value: Double,
        locale: Locale = .autoupdatingCurrent
    ) -> String {
        Measurement(value: value, unit: UnitMass.grams).formatted(
            .measurement(width: .abbreviated, usage: .asProvided)
                .locale(locale)
        )
    }

    public static func durationMinutes(
        _ value: Double,
        locale: Locale = .autoupdatingCurrent
    ) -> String {
        Measurement(value: value, unit: UnitDuration.minutes).formatted(
            .measurement(width: .abbreviated, usage: .asProvided)
                .locale(locale)
        )
    }

    public static func currency(
        _ value: Decimal,
        code: String,
        locale: Locale = .autoupdatingCurrent
    ) -> String {
        value.formatted(.currency(code: code).locale(locale))
    }

    public static func date(
        _ date: Date,
        locale: Locale = .autoupdatingCurrent,
        timeZone: TimeZone = .autoupdatingCurrent,
        calendar: Calendar = Calendar(identifier: .gregorian)
    ) -> String {
        date.formatted(
            Date.FormatStyle(
                date: .long,
                time: .omitted,
                locale: locale,
                calendar: calendar,
                timeZone: timeZone
            )
        )
    }
}
