import {
  TextInput,
  PasswordInput,
  Text,
  Paper,
  Group,
  Button,
  Anchor,
  Stack,
} from "@mantine/core";
import { SyntheticEvent } from "react";
import Link from "next/link";
import { useState } from "react";
import classes from "../styles/LoginForm.module.css";
// import { loginDetails } from "../common/types"; 

interface loginProps {
  loginHandler: (details: { email: string; password: string }) => void;
}

export default function LoginForm({ loginHandler }: loginProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function submitHandler(e: SyntheticEvent) {
    setLoading(true);
    e.preventDefault();

    // Transform username to dummy email
    const email = username + "@winter.com";

    await loginHandler({ email, password });
    setLoading(false);
  }

  return (
    <div className={classes.wrapper}>
      <Paper className={classes.form} radius="md" p="xl" withBorder>
        <Text size="lg" fw={600}>
          登录冬日绘板 (Login)
        </Text>
        <form onSubmit={submitHandler}>
          <Stack>
            <TextInput
              required
              label="用户名 (Username)"
              placeholder="你的用户名"
              radius="md"
              onChange={(e) => setUsername(e.target.value)}
            />
            <PasswordInput
              required
              label="密码 (Password)"
              placeholder="输入密码"
              radius="md"
              onChange={(e) => setPassword(e.target.value)}
            />
          </Stack>
          <Group justify="space-between" mt="xl">
            <Anchor
              component={Link}
              type="button"
              c="dimmed"
              href={"/register"}
              size="xs"
            >
              {"没有账号? 去注册 (Register)"}
            </Anchor>
            <Button
              loading={loading}
              loaderProps={{ type: "dots" }}
              type="submit"
              radius="xl"
            >
              登录
            </Button>
          </Group>
        </form>
      </Paper>
    </div>
  );
}
