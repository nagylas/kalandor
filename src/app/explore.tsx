import { StyleSheet, View } from "react-native";

import { LocationPicker } from "@/components/location-picker";

export default function TabTwoScreen() {
  return (
    <View style={styles.page}>
      <LocationPicker backgroundMap />
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
  },
});
