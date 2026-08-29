import { useColorScheme as useRNColorScheme } from "react-native";

/**
 * Static rendering on web does not need a hydration flag here.
 */
export function useColorScheme() {
  const colorScheme = useRNColorScheme();
  return colorScheme ?? "light";
}
