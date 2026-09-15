import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import type { RootStackParamList } from '../App';
import { useSession } from '../lib/session';
import { styles, colors, spacing } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;

const SUGGESTIONS = ['სამუხრუჭე ხუნდები', 'ზეთის ფილტრი', 'აკუმულატორი', 'რადიატორი'];

/**
 * Home (PRD §83): your car, then your part.
 *
 * The vehicle is chosen before anything can be searched — the app never offers
 * a search box that cannot be answered honestly.
 */
export function HomeScreen({ navigation }: Props) {
  const { vehicles, selectedVehicle, selectVehicle, signOut } = useSession();
  const [query, setQuery] = useState('');

  function search(text: string) {
    if (!text.trim()) return;
    if (!selectedVehicle) {
      navigation.navigate('Garage', {});
      return;
    }
    navigation.navigate('Search', { query: text });
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {vehicles.length === 0 ? (
        <View style={styles.card}>
          <Text style={styles.h1}>დაამატე ავტომობილი VIN-ით</Text>
          <Text style={styles.muted}>
            ნაწილის ძებნა მანქანის გარეშე ვერ დაიწყება — სწორედ ეს არის ის შეცდომა,
            რომლის თავიდან აცილებასაც ეს აპლიკაცია ემსახურება.
          </Text>
          <TouchableOpacity style={styles.button} onPress={() => navigation.navigate('Garage', {})}>
            <Text style={styles.buttonText}>+ ავტომობილის დამატება</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          <Text style={styles.small}>ჩემი ავტომობილები</Text>
          <View style={styles.pillRow}>
            {vehicles.map((vehicle) => (
              <TouchableOpacity
                key={vehicle.id}
                style={[styles.pill, vehicle.id === selectedVehicle?.id && styles.pillActive]}
                onPress={() => selectVehicle(vehicle.id)}
              >
                <Text style={{ color: colors.text }}>🚗 {vehicle.label}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.pill} onPress={() => navigation.navigate('Garage', {})}>
              <Text style={{ color: colors.accent }}>+ დამატება</Text>
            </TouchableOpacity>
          </View>

          <Text style={[styles.h2, { marginTop: spacing.xl }]}>რა ნაწილი გჭირდებათ?</Text>
          <TextInput
            style={styles.input}
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={() => search(query)}
            placeholder="მაგ. სამუხრუჭე ხუნდები"
            placeholderTextColor={colors.muted}
            returnKeyType="search"
          />
          <TouchableOpacity style={styles.button} onPress={() => search(query)}>
            <Text style={styles.buttonText}>ძებნა</Text>
          </TouchableOpacity>

          <View style={styles.pillRow}>
            {SUGGESTIONS.map((suggestion) => (
              <TouchableOpacity key={suggestion} style={styles.pill} onPress={() => search(suggestion)}>
                <Text style={{ color: colors.text }}>{suggestion}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </>
      )}

      <View style={{ height: spacing.xl }} />

      <TouchableOpacity
        style={[styles.button, styles.buttonSecondary]}
        onPress={() => navigation.navigate('Cart')}
      >
        <Text style={[styles.buttonText, styles.buttonTextSecondary]}>კალათა</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.button, styles.buttonSecondary]}
        onPress={() => navigation.navigate('Orders')}
      >
        <Text style={[styles.buttonText, styles.buttonTextSecondary]}>ჩემი შეკვეთები</Text>
      </TouchableOpacity>
      <TouchableOpacity style={[styles.button, styles.buttonSecondary]} onPress={signOut}>
        <Text style={[styles.buttonText, styles.buttonTextSecondary]}>გასვლა</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}
