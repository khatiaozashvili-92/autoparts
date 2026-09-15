import { useState } from 'react';
import { ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSession } from '../lib/session';
import { styles, colors } from '../theme';

export function SignInScreen() {
  const { signIn, t } = useSession();
  const [identifier, setIdentifier] = useState('customer@autoparts.dev');
  const [password, setPassword] = useState('dev-password-change-me');
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setErrorKey(null);
    try {
      await signIn(identifier, password);
    } catch (error) {
      // The API returns an i18n key; rendering its English `message` would show
      // developer copy to a customer (PRD §80).
      setErrorKey(
        typeof error === 'object' && error !== null && 'messageKey' in error
          ? String((error as { messageKey: string }).messageKey)
          : 'error.internal',
      );
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
        <Text style={styles.small}>Email ან ტელეფონი</Text>
        <TextInput
          style={styles.input}
          value={identifier}
          onChangeText={setIdentifier}
          autoCapitalize="none"
          keyboardType="email-address"
        />

        <Text style={styles.small}>პაროლი</Text>
        <TextInput
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />

        {errorKey && (
          <View style={[styles.banner, styles.bannerError]}>
            <Text style={{ color: colors.accent }}>{t(errorKey)}</Text>
          </View>
        )}

        <TouchableOpacity
          style={[styles.button, busy && styles.buttonDisabled]}
          onPress={submit}
          disabled={busy}
          accessibilityRole="button"
        >
          <Text style={styles.buttonText}>{busy ? '…' : 'შესვლა'}</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}
