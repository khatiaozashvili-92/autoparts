import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import type { VinDecodeResponse } from '@autoparts/api-client';
import type { RootStackParamList } from '../App';
import { useSession } from '../lib/session';
import { styles, colors, spacing } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Garage'>;

const FIELDS: [string, string][] = [
  ['make', 'მარკა'],
  ['model', 'მოდელი'],
  ['modelYear', 'წელი'],
  ['engine', 'ძრავი'],
  ['engineCode', 'ძრავის კოდი'],
  ['transmission', 'ტრანსმისია'],
  ['driveType', 'წამყვანი'],
  ['bodyType', 'ძარა'],
  ['market', 'ბაზარი'],
];

const SAMPLES: [string, string][] = [
  ['WBA1J5C50FV123456', 'BMW 228i'],
  ['2HKRW2H875H112233', 'Honda CR-V'],
  ['W0L0AHL0885667788', 'Opel Astra'],
];

export function GarageScreen({ navigation }: Props) {
  const { api, t, vehicles, reloadGarage, selectVehicle } = useSession();
  const [vin, setVin] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [decoded, setDecoded] = useState<VinDecodeResponse | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});

  function reportError(error: unknown) {
    setErrorKey(
      typeof error === 'object' && error !== null && 'messageKey' in error
        ? String((error as { messageKey: string }).messageKey)
        : 'error.internal',
    );
  }

  async function decode(value = vin) {
    setBusy(true);
    setErrorKey(null);
    setDecoded(null);
    setAnswers({});
    try {
      setDecoded(await api.decodeVin(value));
    } catch (error) {
      reportError(error);
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!decoded) return;
    setBusy(true);
    try {
      const vehicle = await api.addVehicle({
        configurationId: decoded.configurationId,
        ...(Object.keys(answers).length ? { clarificationAnswers: answers } : {}),
      });
      await reloadGarage();
      selectVehicle(vehicle.id);
      navigation.goBack();
    } catch (error) {
      reportError(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.card}>
        <Text style={styles.small}>VIN — 17 სიმბოლო</Text>
        <TextInput
          style={[styles.input, styles.mono]}
          value={vin}
          onChangeText={(text) => setVin(text.toUpperCase().replace(/\s/g, ''))}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={17}
          placeholder="WBA1J5C50FV123456"
          placeholderTextColor={colors.muted}
        />
        <TouchableOpacity
          style={[styles.button, (busy || vin.length < 11) && styles.buttonDisabled]}
          onPress={() => decode()}
          disabled={busy || vin.length < 11}
        >
          <Text style={styles.buttonText}>{busy ? '…' : 'ამოცნობა'}</Text>
        </TouchableOpacity>

        <View style={styles.pillRow}>
          {SAMPLES.map(([sample, label]) => (
            <TouchableOpacity
              key={sample}
              style={styles.pill}
              onPress={() => {
                setVin(sample);
                void decode(sample);
              }}
            >
              <Text style={{ color: colors.text }}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {errorKey && (
          <View style={[styles.banner, styles.bannerError]}>
            <Text style={{ color: colors.accent }}>{t(errorKey)}</Text>
          </View>
        )}
      </View>

      {decoded && (
        <View style={styles.card}>
          <Text style={styles.h2}>ვიპოვეთ თქვენი ავტომობილი</Text>
          {FIELDS.map(([key, label]) => {
            const value = decoded.configuration[key];
            if (value === null || value === undefined || value === '') return null;
            return (
              <View style={styles.row} key={key}>
                <Text style={styles.muted}>{label}</Text>
                <Text style={styles.body}>{String(value)}</Text>
              </View>
            );
          })}
          <View style={styles.row}>
            <Text style={styles.muted}>VIN</Text>
            <Text style={[styles.body, styles.mono]}>{decoded.vinMasked}</Text>
          </View>

          {decoded.clarifications.map((question) => (
            <View key={question.id} style={{ gap: spacing.sm, marginTop: spacing.md }}>
              <Text style={styles.body}>{t(question.questionKey)}</Text>
              <View style={styles.pillRow}>
                {question.options.map((option) => (
                  <TouchableOpacity
                    key={option.value}
                    style={[
                      styles.pill,
                      answers[question.attribute] === option.value && styles.pillActive,
                    ]}
                    onPress={() => setAnswers({ ...answers, [question.attribute]: option.value })}
                  >
                    <Text style={{ color: colors.text }}>{t(option.labelKey)}</Text>
                  </TouchableOpacity>
                ))}
                <TouchableOpacity
                  style={styles.pill}
                  onPress={() => {
                    const { [question.attribute]: _skipped, ...rest } = answers;
                    setAnswers(rest);
                  }}
                >
                  <Text style={{ color: colors.text }}>არ ვიცი</Text>
                </TouchableOpacity>
              </View>
              {!answers[question.attribute] && (
                <Text style={styles.small}>
                  უპასუხოდ დატოვება დასაშვებია — ამ ატრიბუტზე დამოკიდებული ნაწილები უბრალოდ
                  არ გამოჩნდება. გამოცნობა არასწორ მონაცემს შექმნიდა.
                </Text>
              )}
            </View>
          ))}

          <TouchableOpacity style={styles.button} onPress={confirm} disabled={busy}>
            <Text style={styles.buttonText}>სწორია, დამატება</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.button, styles.buttonSecondary]}
            onPress={() => setDecoded(null)}
          >
            <Text style={[styles.buttonText, styles.buttonTextSecondary]}>
              ეს ჩემი მანქანა არ არის
            </Text>
          </TouchableOpacity>
        </View>
      )}

      <Text style={styles.h2}>ავტომობილები ({vehicles.length})</Text>
      {vehicles.map((vehicle) => (
        <TouchableOpacity
          key={vehicle.id}
          style={styles.card}
          onPress={() => {
            selectVehicle(vehicle.id);
            navigation.goBack();
          }}
        >
          <Text style={styles.body}>🚗 {vehicle.label}</Text>
          {vehicle.vinMasked && (
            <Text style={[styles.small, styles.mono]}>{vehicle.vinMasked}</Text>
          )}
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}
