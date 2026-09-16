import { useState } from 'react';
import { ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import type { OtpChallenge } from '@autoparts/api-client';
import { useSession } from '../lib/session';
import { styles, colors } from '../theme';

/**
 * Phone number, then a six-digit code (ADR-015).
 *
 * The same two steps as the web login page, and the same rule: there is no
 * register/sign-in choice to make, because the API decides that from whether
 * the number is already known.
 */
export function SignInScreen() {
  const { requestCode, verifyCode, t } = useSession();

  const [phone, setPhone] = useState('555 00 00 01');
  const [challenge, setChallenge] = useState<OtpChallenge | null>(null);
  const [code, setCode] = useState('');
  const [firstName, setFirstName] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  // The API returns an i18n key; rendering its English `message` would show
  // developer copy to a customer (PRD §80).
  function keyFor(error: unknown): string {
    return typeof error === 'object' && error !== null && 'messageKey' in error
      ? String((error as { messageKey: string }).messageKey)
      : 'error.internal';
  }

  async function send() {
    setBusy(true);
    setErrorKey(null);
    try {
      setChallenge(await requestCode(phone));
      setCode('');
    } catch (error) {
      setErrorKey(keyFor(error));
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!challenge) return;
    setBusy(true);
    setErrorKey(null);
    try {
      await verifyCode({
        challengeId: challenge.challengeId,
        code,
        firstName: firstName.trim() || undefined,
      });
    } catch (error) {
      setErrorKey(keyFor(error));
      setCode('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={[styles.content, { paddingTop: 80 }]}>
      <Text style={styles.h1}>autoparts</Text>
      <Text style={styles.muted}>
        შეიყვანე VIN ერთხელ და აღარასოდეს იფიქრო, მოერგება თუ არა ნაწილი შენს მანქანას.
      </Text>

      <View style={[styles.card, { marginTop: 24 }]}>
        {!challenge ? (
          <>
            <Text style={styles.small}>{t('auth.phoneLabel')}</Text>
            <TextInput
              style={styles.input}
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              autoComplete="tel"
              textContentType="telephoneNumber"
            />
            <Text style={styles.muted}>{t('auth.phoneHint')}</Text>
          </>
        ) : (
          <>
            <Text style={styles.muted}>
              {t('auth.codeSentTo')} {challenge.maskedPhone}
            </Text>

            <Text style={styles.small}>{t('auth.codeLabel')}</Text>
            <TextInput
              style={[styles.input, { fontSize: 24, letterSpacing: 8, textAlign: 'center' }]}
              value={code}
              onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
              keyboardType="number-pad"
              maxLength={6}
              autoFocus
              // Lets iOS and Android offer the code straight from the SMS.
              textContentType="oneTimeCode"
              autoComplete="sms-otp"
            />

            <Text style={styles.small}>{t('auth.nameLabel')}</Text>
            <TextInput style={styles.input} value={firstName} onChangeText={setFirstName} />
            <Text style={styles.muted}>{t('auth.nameHint')}</Text>

            {challenge.devCode ? (
              <Text style={styles.muted}>
                SMS gateway: console — {t('auth.codeLabel')}: {challenge.devCode}
              </Text>
            ) : null}
          </>
        )}

        {errorKey && (
          <View style={[styles.banner, styles.bannerError]}>
            <Text style={{ color: colors.accent }}>{t(errorKey)}</Text>
          </View>
        )}

        <TouchableOpacity
          style={[styles.button, busy && styles.buttonDisabled]}
          onPress={challenge ? confirm : send}
          disabled={busy || (challenge ? code.length < 6 : phone.trim().length === 0)}
          accessibilityRole="button"
        >
          <Text style={styles.buttonText}>
            {busy ? '…' : challenge ? t('auth.verify') : t('auth.sendCode')}
          </Text>
        </TouchableOpacity>

        {challenge && (
          <TouchableOpacity
            onPress={() => {
              setChallenge(null);
              setErrorKey(null);
            }}
            disabled={busy}
            accessibilityRole="button"
          >
            <Text style={[styles.muted, { textAlign: 'center', marginTop: 12 }]}>
              {t('auth.changeNumber')}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </ScrollView>
  );
}
