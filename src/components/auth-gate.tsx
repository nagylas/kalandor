import {
    createUserWithEmailAndPassword,
    onAuthStateChanged,
    signInWithEmailAndPassword,
    signOut,
    type User,
} from "firebase/auth";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { auth, db } from "@/../firebase";

const ADMIN_EMAILS = (process.env.EXPO_PUBLIC_ADMIN_EMAILS ?? "")
  .split(",")
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);

type AuthGateProps = {
  children: React.ReactNode;
};

function isAdminEmail(email?: string | null) {
  return !!email && ADMIN_EMAILS.includes(email.toLowerCase());
}

export default function AuthGate({ children }: AuthGateProps) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [authReady, setAuthReady] = useState(false);
  const [role, setRole] = useState<"admin" | "user" | null>(null);

  useEffect(() => {
    if (!auth) {
      setLoading(false);
      setAuthReady(false);
      setError(
        "Firebase is not configured yet. Add the web config values in .env",
      );
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, async (nextUser) => {
      setUser(nextUser);

      if (!nextUser || !db) {
        setRole(null);
        setLoading(false);
        setAuthReady(true);
        return;
      }

      try {
        const userRef = doc(db, "users", nextUser.uid);
        const snap = await getDoc(userRef);
        const emailMatchesAdmin = ADMIN_EMAILS.includes(
          (nextUser.email ?? "").toLowerCase(),
        );

        let nextRole: "admin" | "user" = emailMatchesAdmin ? "admin" : "user";

        if (snap.exists()) {
          const snapshotRole = snap.data()?.role;
          if (snapshotRole === "admin" || snapshotRole === "user") {
            nextRole = snapshotRole;
          }
        } else {
          await setDoc(userRef, {
            uid: nextUser.uid,
            email: nextUser.email,
            role: nextRole,
            createdAt: new Date().toISOString(),
          });
        }

        setRole(nextRole);
      } catch (firestoreError) {
        console.warn("Unable to resolve Firebase user role:", firestoreError);
        setRole(
          ADMIN_EMAILS.includes((nextUser.email ?? "").toLowerCase())
            ? "admin"
            : "user",
        );
      } finally {
        setLoading(false);
        setAuthReady(true);
      }
    });

    return unsubscribe;
  }, []);

  const handleSubmit = async () => {
    if (!auth) {
      setError("Firebase is not configured yet.");
      return;
    }

    setError("");

    try {
      if (mode === "signup") {
        await createUserWithEmailAndPassword(auth, email, password);
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Authentication failed.";
      setError(message);
    }
  };

  if (!authReady && loading) {
    return (
      <View style={styles.centered}>
        <Text style={styles.title}>Loading...</Text>
      </View>
    );
  }

  if (!auth) {
    return (
      <View style={styles.centered}>
        <Text style={styles.title}>Firebase configuration required</Text>
        <Text style={styles.subtitle}>
          Add your Firebase web config values to the Expo environment before
          launching the app.
        </Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <Text style={styles.title}>Checking access...</Text>
      </View>
    );
  }

  if (!user) {
    return (
      <View style={styles.authContainer}>
        <View style={styles.authCard}>
          <Text style={styles.title}>Sign in</Text>
          <Text style={styles.subtitle}>
            Admin access is restricted to configured administrators.
          </Text>

          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="Email"
            autoCapitalize="none"
            keyboardType="email-address"
            style={styles.input}
          />
          <TextInput
            value={password}
            onChangeText={setPassword}
            placeholder="Password"
            secureTextEntry
            style={styles.input}
          />

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Pressable style={styles.primaryButton} onPress={handleSubmit}>
            <Text style={styles.primaryButtonText}>
              {mode === "login" ? "Login" : "Create account"}
            </Text>
          </Pressable>

          <Pressable
            onPress={() =>
              setMode((prev) => (prev === "login" ? "signup" : "login"))
            }
          >
            <Text style={styles.switchText}>
              {mode === "login"
                ? "Need an account? Sign up"
                : "Already have an account? Log in"}
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const isAdmin = role === "admin" || isAdminEmail(user.email);

  if (!isAdmin) {
    return (
      <View style={styles.welcomeContainer}>
        <Text style={styles.welcomeTitle}>Welcome</Text>
        <Text style={styles.welcomeText}>
          Your account is registered, but this frontend is currently available
          for administrators only.
        </Text>
        <Text style={styles.welcomeEmail}>{user.email}</Text>
        <Pressable style={styles.secondaryButton} onPress={() => signOut(auth)}>
          <Text style={styles.secondaryButtonText}>Sign out</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.adminShell}>
      <View style={styles.adminHeader}>
        <View>
          <Text style={styles.adminLabel}>Admin</Text>
          <Text style={styles.adminEmail}>{user.email}</Text>
        </View>
        <Pressable style={styles.adminButton} onPress={() => signOut(auth)}>
          <Text style={styles.adminButtonText}>Log out</Text>
        </Pressable>
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    backgroundColor: "#081220",
  },
  authContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#081220",
    padding: 24,
  },
  authCard: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: "#101b2b",
    borderRadius: 18,
    padding: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: "#f5f7fa",
    marginBottom: 8,
  },
  subtitle: {
    color: "#c3d0df",
    fontSize: 14,
    marginBottom: 20,
    lineHeight: 20,
  },
  input: {
    backgroundColor: "#0e1727",
    borderWidth: 1,
    borderColor: "#243447",
    borderRadius: 12,
    color: "#f5f7fa",
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
  },
  error: {
    color: "#ffb3b3",
    fontSize: 12,
    marginBottom: 12,
  },
  primaryButton: {
    backgroundColor: "#2f80ed",
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
    marginTop: 8,
  },
  primaryButtonText: {
    color: "#fff",
    fontWeight: "700",
  },
  switchText: {
    marginTop: 16,
    color: "#9ec5ff",
    textAlign: "center",
  },
  welcomeContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#081220",
    padding: 24,
  },
  welcomeTitle: {
    fontSize: 40,
    fontWeight: "700",
    color: "#f5f7fa",
    marginBottom: 12,
  },
  welcomeText: {
    color: "#d8e3f2",
    fontSize: 18,
    textAlign: "center",
    maxWidth: 520,
    lineHeight: 28,
  },
  welcomeEmail: {
    color: "#a7d0ff",
    fontSize: 16,
    marginTop: 18,
    marginBottom: 28,
  },
  secondaryButton: {
    backgroundColor: "#1f2d3d",
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 20,
  },
  secondaryButtonText: {
    color: "#f5f7fa",
    fontWeight: "700",
  },
  adminShell: {
    flex: 1,
    backgroundColor: "#081220",
  },
  adminHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#1f2d3d",
    backgroundColor: "#0d1725",
  },
  adminLabel: {
    color: "#a7d0ff",
    fontSize: 11,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  adminEmail: {
    color: "#eef4ff",
    fontSize: 13,
    fontWeight: "600",
  },
  adminButton: {
    backgroundColor: "#1f2d3d",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  adminButtonText: {
    color: "#fff",
    fontWeight: "600",
  },
});
