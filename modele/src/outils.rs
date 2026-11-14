//! Ce que Python faisait tout seul et que les trois modules se partagent : min() et max() qui
//! gardent le premier de deux égaux, str(), les formats « %g », et la lecture du JSON de la page.

use ipc2581::py::{repr_flottant, Json, Objet};

/// min(a, b) de Python : `a`, sauf si `b` est strictement plus petit (0.0 et -0.0 sont égaux,
/// et le JSON montre lequel des deux est resté).
pub fn mini(a: f64, b: f64) -> f64 {
    if b < a { b } else { a }
}

/// max(a, b) de Python : `a`, sauf si `b` est strictement plus grand.
pub fn maxi(a: f64, b: f64) -> f64 {
    if b > a { b } else { a }
}

/// min() d'une suite non vide.
pub fn min_de(valeurs: impl IntoIterator<Item = f64>) -> f64 {
    valeurs.into_iter().reduce(mini).unwrap_or(0.0)
}

/// max() d'une suite non vide.
pub fn max_de(valeurs: impl IntoIterator<Item = f64>) -> f64 {
    valeurs.into_iter().reduce(maxi).unwrap_or(0.0)
}

/// Une liste de flottants, telle que json.dumps l'écrit.
pub fn nombres(valeurs: impl IntoIterator<Item = f64>) -> Json {
    Json::Liste(valeurs.into_iter().map(Json::Flottant).collect())
}

/// Un dict littéral : obj!{"cle" => valeur, ...}, clés dans l'ordre d'écriture.
#[macro_export]
macro_rules! obj {
    ($($k:expr => $v:expr),* $(,)?) => {{
        #[allow(unused_mut)]
        let mut o = ipc2581::py::Objet::new();
        $(o.insert(String::from($k), ipc2581::py::Json::from($v));)*
        ipc2581::py::Json::Objet(o)
    }};
}

/// str(v) : un texte tel quel, un nombre à sa repr, True / False / None, et la repr d'une
/// liste ou d'un dict.
pub fn py_str(v: &Json) -> String {
    match v {
        Json::Texte(t) => t.clone(),
        _ => py_repr(v),
    }
}

fn py_repr(v: &Json) -> String {
    match v {
        Json::Nul => "None".into(),
        Json::Bool(b) => if *b { "True" } else { "False" }.into(),
        Json::Entier(i) => i.to_string(),
        Json::GrandEntier(t) => t.clone(),
        Json::Flottant(f) => repr_flottant(*f),
        // shortcut: repr() d'un texte sans ses échappements Unicode (\x.., \u....) ; à compléter
        // si un document porte un jour un caractère de contrôle dans une liste prise pour un nom
        Json::Texte(t) => {
            let q = if t.contains('\'') && !t.contains('"') { '"' } else { '\'' };
            let mut s = String::from(q);
            for c in t.chars() {
                match c {
                    '\\' => s.push_str("\\\\"),
                    '\n' => s.push_str("\\n"),
                    '\r' => s.push_str("\\r"),
                    '\t' => s.push_str("\\t"),
                    c if c == q => {
                        s.push('\\');
                        s.push(c);
                    }
                    c => s.push(c),
                }
            }
            s.push(q);
            s
        }
        Json::Liste(l) => format!("[{}]", l.iter().map(py_repr).collect::<Vec<_>>().join(", ")),
        Json::Objet(o) => format!(
            "{{{}}}",
            o.iter().map(|(k, e)| format!("{}: {}", py_repr(&Json::Texte(k.clone())), py_repr(e))).collect::<Vec<_>>().join(", ")
        ),
    }
}

/// « %.{p}g » % x : p chiffres significatifs, les zéros de queue retirés, l'exposant dès
/// qu'il sort de [-4, p[.
pub fn fmt_g(x: f64, p: usize) -> String {
    if x.is_nan() {
        return "nan".into();
    }
    if x.is_infinite() {
        return if x > 0.0 { "inf" } else { "-inf" }.into();
    }
    let p = p.max(1);
    let e = format!("{:.*e}", p - 1, x);
    let (mantisse, exposant) = e.split_once('e').unwrap_or((&e, "0"));
    let exposant: i32 = exposant.parse().unwrap_or(0);
    let rogner = |t: &str| -> String {
        if t.contains('.') { t.trim_end_matches('0').trim_end_matches('.').to_string() } else { t.to_string() }
    };
    if exposant < -4 || exposant >= p as i32 {
        return format!("{}e{}{:02}", rogner(mantisse), if exposant < 0 { '-' } else { '+' }, exposant.abs());
    }
    rogner(&format!("{:.*}", (p as i32 - 1 - exposant).max(0) as usize, x))
}

/// json.loads(texte) : le document de la page, clés dans l'ordre, un entier restant un entier.
// shortcut: NaN / Infinity (que json.loads accepte) et les entiers au-delà de 64 bits sont
// refusés ou lus en flottant par serde_json ; la page n'en écrit pas
pub fn json_depuis_texte(texte: &str) -> Result<Json, String> {
    let v: serde_json::Value = serde_json::from_str(texte).map_err(|e| e.to_string())?;
    Ok(depuis_serde(v))
}

fn depuis_serde(v: serde_json::Value) -> Json {
    match v {
        serde_json::Value::Null => Json::Nul,
        serde_json::Value::Bool(b) => Json::Bool(b),
        serde_json::Value::Number(n) => match (n.as_i64(), n.as_u64(), n.as_f64()) {
            (Some(i), _, _) => Json::Entier(i),
            (None, Some(u), _) => Json::GrandEntier(u.to_string()),
            (None, None, f) => Json::Flottant(f.unwrap_or(f64::NAN)),
        },
        serde_json::Value::String(t) => Json::Texte(t),
        serde_json::Value::Array(l) => Json::Liste(l.into_iter().map(depuis_serde).collect()),
        serde_json::Value::Object(o) => {
            let mut out = Objet::new();
            for (k, e) in o {
                out.insert(k, depuis_serde(e));
            }
            Json::Objet(out)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_de_python() {
        // relevés sur Python 3.13 : "%.4g" % x, "%g" % x, "%.3g" % x
        for (x, p, attendu) in [(2.45, 4, "2.45"), (2450000000.0, 4, "2.45e+09"), (0.0001234, 4, "0.0001234"),
                                (0.00001234, 4, "1.234e-05"), (100000.0, 6, "100000"), (1000000.0, 6, "1e+06"),
                                (4.0, 6, "4"), (0.0, 6, "0"), (-90.0, 6, "-90"), (12.5, 6, "12.5"),
                                (4.04e-13, 3, "4.04e-13"), (999999.5, 6, "1e+06"), (0.1 + 0.2, 6, "0.3"),
                                (123456789.0, 4, "1.235e+08"), (9999.5, 4, "1e+04"), (30.0, 6, "30")] {
            assert_eq!(fmt_g(x, p), attendu, "{x} {p}");
        }
        assert_eq!((mini(0.0, -0.0).to_bits(), maxi(-0.0, 0.0).to_bits()), (0.0f64.to_bits(), (-0.0f64).to_bits()));
        let v = json_depuis_texte(r#"{"b": 1, "a": [1.0, "x", null, true], "b": 2}"#).unwrap();
        assert_eq!(ipc2581::py::dumps(&v), r#"{"b": 2, "a": [1.0, "x", null, true]}"#);
        assert_eq!(py_str(&v["a"]), "[1.0, 'x', None, True]");
    }
}
