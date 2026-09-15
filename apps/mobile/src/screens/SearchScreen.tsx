import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { formatMoney, type SearchResponse } from '@autoparts/api-client';
import type { RootStackParamList } from '../App';
import { useSession } from '../lib/session';
import { styles, colors } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Search'>;

export function SearchScreen({ route, navigation }: Props) {
  const { api, t, selectedVehicle } = useSession();
  const [results, setResults] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const run = useCallback(async () => {
    if (!selectedVehicle) return;
    setLoading(true);
    try {
      setResults(await api.search(route.params.query, selectedVehicle.id));
    } catch {
      setResults(null);
    } finally {
      setLoading(false);
    }
  }, [api, route.params.query, selectedVehicle]);

  useEffect(() => {
    void run();
  }, [run]);

  if (loading) {
    return (
      <View style={[styles.screen, { alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {selectedVehicle && (
        <Text style={styles.muted}>შედეგები {selectedVehicle.label}-სთვის</Text>
      )}

      {results?.interpreted?.didYouMean && (
        <View style={[styles.banner, styles.bannerWarn]}>
          <Text style={styles.body}>გასწორდა: {results.interpreted.didYouMean}</Text>
        </View>
      )}

      {(!results || results.data.length === 0) && (
        <View style={styles.card}>
          <Text style={styles.body}>ვერაფერი მოიძებნა</Text>
          <Text style={styles.small}>
            დაუდასტურებელ ალტერნატივას განზრახ არ გთავაზობთ — არასწორი ნაწილი უარესია,
            ვიდრე ცარიელი შედეგი.
          </Text>
        </View>
      )}

      {results?.data.map((hit) => (
        <TouchableOpacity
          key={hit.productId}
          style={styles.card}
          onPress={() =>
            navigation.navigate('Product', { productId: hit.productId, name: hit.name })
          }
        >
          {/* Only confirmed fits ever reach this list (R1). */}
          <Text style={{ color: colors.ok, fontSize: 13 }}>✅ {t(hit.fitment.labelKey)}</Text>
          <Text style={styles.body}>{hit.name}</Text>
          <Text style={styles.small}>
            {hit.brand.name}
            {hit.oem ? ` · OEM ${hit.oem}` : ''}
          </Text>
          <View style={styles.row}>
            <Text style={styles.muted}>{hit.offerSummary.count} შეთავაზება</Text>
            {hit.offerSummary.minCustomerPriceMinor && hit.offerSummary.currency && (
              <Text style={styles.price}>
                {formatMoney(hit.offerSummary.minCustomerPriceMinor, hit.offerSummary.currency)}-დან
              </Text>
            )}
          </View>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}
