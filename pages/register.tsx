import {
  Paper,
  TextInput,
  PasswordInput,
  Button,
  Title,
  Text,
  Anchor,
} from "@mantine/core";
import classes from "../styles/AuthForm.module.css";
import Link from "next/link";
import { SyntheticEvent } from "react";
import { useState } from "react";
import { API_URL } from "../common/constants";
// import { User } from "../common/types"; // Unused interface

interface userFormData {
  name: string;
  password: string;
  confirmPassword: string;
  remark: string;
  inviteCode: string;
}

export default function RegistrationForm() {
  const [values, setValues] = useState<userFormData>({
    name: "",
    password: "",
    confirmPassword: "",
    remark: "",
    inviteCode: "",
  });
  const [loading, setLoading] = useState(false);

  async function submitHandler(e: SyntheticEvent) {
    e.preventDefault();
    setLoading(true);

    const payload = {
      ...values,
      email: values.name + "@winter.com", // Dummy email
      type: "Basic"
    };

    try {
      const response = await fetch(`${API_URL}/auth/register`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        window.alert("注册成功！请前往登录。(Registration successful)");
        // Redirect?
        window.location.href = "/login";
        return;
      }
      // else an error occurred
      const json = await response.json();
      window.alert(json.error || "注册失败");
    } catch (error) {
      console.log(error);
      window.alert("无法连接服务器。");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={classes.wrapper}>
      <Paper className={classes.form} radius={0} p={30}>
        <Title order={2} className={classes.title} ta="center" mt="md" mb={50}>
          {"加入冬日绘板"}
        </Title>

        <form onSubmit={submitHandler}>
          <TextInput
            required
            onChange={(e) => setValues({ ...values, name: e.target.value })}
            label="用户名 (Username)"
            placeholder="你的显示名称 (用于登录)"
            size="md"
            mt="md"
          />
          <TextInput
            required
            onChange={(e) => setValues({ ...values, remark: e.target.value })}
            label="备注 (实名/班级)"
            placeholder="例如: 高一(1)班 张三"
            size="md"
            mt="md"
          />
          <TextInput
            required
            onChange={(e) => setValues({ ...values, inviteCode: e.target.value })}
            label="邀请码 (Invitation Code)"
            placeholder="请向已有帐号的同学索取"
            size="md"
            mt="md"
          />
          <PasswordInput
            required
            label="密码 (Password)"
            placeholder="设置你的密码"
            mt="md"
            size="md"
            onChange={(e) => setValues({ ...values, password: e.target.value })}
          />
          <PasswordInput
            required
            label="确认密码 (Confirm Password)"
            placeholder="再次输入密码"
            mt="md"
            size="md"
            onChange={(e) =>
              setValues({ ...values, confirmPassword: e.target.value })
            }
          />

          <Button type="submit" fullWidth mt="xl" size="md" loading={loading}>
            {"注册 (Register)"}
          </Button>
        </form>

        <Text ta="center" mt="md">
          {"已有账号? "}
          <Anchor component={Link} href={"/login"} fw={700}>
            {" 去登录"}
          </Anchor>
        </Text>
      </Paper>
    </div>
  );
}
