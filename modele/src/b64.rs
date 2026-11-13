//! La base 64 telle que Python la lit et l'écrit (base64.b64decode sans `validate`,
//! base64.b64encode) : les pièces et les champs voyagent ainsi entre la page et le serveur.

const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/// base64.b64decode(texte) de Python 3.13 : les caractères hors alphabet et les « = » sont
/// sautés, et seul le bourrage de la fin compte. None là où Python lève binascii.Error (ou
/// ValueError pour un texte non ASCII).
pub fn decoder(texte: &str) -> Option<Vec<u8>> {
    if !texte.is_ascii() {
        return None;
    }
    let mut out = Vec::with_capacity(texte.len() / 4 * 3);
    let (mut quad, mut reste, mut bourrage) = (0u8, 0u8, 0u8);
    for &c in texte.as_bytes() {
        if c == b'=' {
            if quad >= 2 {
                bourrage += 1;
            }
            continue;
        }
        let v = match c {
            b'A'..=b'Z' => c - b'A',
            b'a'..=b'z' => c - b'a' + 26,
            b'0'..=b'9' => c - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            _ => continue,
        };
        bourrage = 0;
        match quad {
            0 => reste = v,
            1 => {
                out.push((reste << 2) | (v >> 4));
                reste = v & 0x0f;
            }
            2 => {
                out.push((reste << 4) | (v >> 2));
                reste = v & 0x03;
            }
            _ => out.push((reste << 6) | v),
        }
        quad = (quad + 1) % 4;
    }
    if quad != 0 && quad + bourrage < 4 {
        return None; // « Incorrect padding »
    }
    Some(out)
}

/// base64.b64encode(octets).decode("ascii")
pub fn encoder(octets: &[u8]) -> String {
    let mut s = String::with_capacity(octets.len().div_ceil(3) * 4);
    for b in octets.chunks(3) {
        let n = (b[0] as u32) << 16 | (*b.get(1).unwrap_or(&0) as u32) << 8 | *b.get(2).unwrap_or(&0) as u32;
        s.push(ALPHABET[(n >> 18) as usize] as char);
        s.push(ALPHABET[(n >> 12 & 63) as usize] as char);
        s.push(if b.len() > 1 { ALPHABET[(n >> 6 & 63) as usize] as char } else { '=' });
        s.push(if b.len() > 2 { ALPHABET[(n & 63) as usize] as char } else { '=' });
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn comme_python() {
        // relevés sur Python 3.13 (base64.b64decode, validate=False)
        for (t, attendu) in [("aGVsbG8=", Some(&b"hello"[..])), ("aGV sbG\n8=", Some(b"hello")), ("aGVsbG8", None),
                             ("a", None), ("", Some(b"")), ("aGk=aGk=", None), ("=aGk=", Some(b"hi")),
                             ("aG=k", None), ("aGk=!", Some(b"hi")), ("aGk===", Some(b"hi")), ("aG==", Some(b"h")),
                             ("aG=", None), ("aG=\n=", Some(b"h")), ("aGk=aGkh", None), ("aGkh=aGkh", Some(b"hi!hi!")),
                             ("aG==aGk=", None), ("a=Gk=", Some(b"hi")), ("aG=kh", Some(b"hi!")), ("====", Some(b"")),
                             ("aGkhaG=x=", Some(b"hi!hl")), ("aGkha===", None), ("é", None)] {
            assert_eq!(decoder(t).as_deref(), attendu, "{t:?}");
        }
        for t in [&b""[..], b"a", b"ab", b"abc", b"\x00\xff\x10\x80"] {
            assert_eq!(decoder(&encoder(t)).as_deref(), Some(t));
        }
        assert_eq!(encoder(b"hello"), "aGVsbG8=");
    }
}
